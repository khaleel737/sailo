import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, type Order, type Shop } from "@sailo/db/schema";
import type { OrderStatus } from "@sailo/core/order-status";
import { isStockReleasingStatus, restoreStock, retakeStock } from "../catalog/inventory";
import { reinstateTicketsForOrder, voidTicketsForOrder } from "../ticketing/tickets";
import { emitOrderWebhook } from "@sailo/webhooks/emit";

/**
 * A seller changing an order's status, and everything that has to move with it.
 *
 * This is the whole rule, in one place, because there are now two surfaces that
 * change a status — the web admin's dropdown and the mobile app — and the parts
 * that follow the status are the parts that are silent when they are missed. A
 * bare `UPDATE orders SET status` is what the seller sees working; the units
 * still off the shelf and the tickets still scanning at the door are what they
 * find out about later, from a buyer.
 *
 * Two functions, and the split is between "what the row owes" and "who else is
 * told". `applyOrderStatus` writes the status and settles the stock and the
 * admissions. `changeOrderStatus` wraps it and adds the announcements — the
 * outbound webhooks, and a cache invalidation the caller hands in. Both
 * surfaces call the wrapper; nothing calls the inner one expecting the
 * announcements to have happened.
 *
 * What is *still* not here: the buyer's booking-decision email. It lives in a
 * 3,000-line module in apps/web that owns Resend, the HTML layout and fifteen
 * other messages, and dragging that into a commerce package to reach one of
 * them would be the wrong trade. `changeOrderStatus` returns the transition
 * facts instead, so the web action can send it from the same decision this made
 * — and when `packages/email` exists it moves here and that branch disappears.
 */

export type OrderStatusChange = {
  /**
   * The order as it read *before* the write.
   *
   * Returned rather than the new row because every side effect a caller adds
   * is guarded on the *transition*, not the destination: "the seller has just
   * cancelled this" and "the seller re-saved a dropdown that already said
   * cancelled" are the same new row and different events. Emailing on the
   * second is how a buyer gets told four times.
   */
  previous: Order;
  status: OrderStatus;
  /** Whether this call is the one that put the units back. */
  restocked: boolean;
  /** Whether this call is the one that took them off again. */
  retaken: boolean;
};

/**
 * Writes the status and settles what it owes, or answers null when no order in
 * that shop has that id.
 *
 * Null rather than a throw: the caller knows whether a missing row is a
 * refused request (the API's `NOT_FOUND`) or a stale form post (the web
 * action's silent return), and this cannot tell them apart.
 */
export async function applyOrderStatus(input: {
  shopId: string;
  orderId: string;
  status: OrderStatus;
}): Promise<OrderStatusChange | null> {
  const db = getDb();

  const previous = await db.query.orders.findFirst({
    where: and(eq(orders.id, input.orderId), eq(orders.shopId, input.shopId)),
  });
  if (!previous) return null;

  await db
    .update(orders)
    .set({ status: input.status, updatedAt: new Date() })
    /*
     * Scoped again, though the read above already proved ownership. The two
     * statements are not one transaction, so between them is a real gap — and
     * the cost of closing it is a second predicate on an indexed column.
     */
    .where(and(eq(orders.id, input.orderId), eq(orders.shopId, input.shopId)));

  let restocked = false;
  let retaken = false;

  /*
   * A cancelled *or refunded* order's units go back on the shelf; moving it
   * back out of either takes them off again, so the count follows the seller
   * rather than drifting.
   */
  if (isStockReleasingStatus(input.status)) {
    restocked = await restoreStock(previous);
    /*
     * And the admissions, for exactly the same reason the units go back. A
     * ticket is stock that walks through a door: leaving the code in the
     * buyer's inbox working after a refund means the seat can be sold twice
     * and both people can turn up.
     */
    await voidTicketsForOrder(input.orderId);
  } else if (previous.status === "cancelled" && previous.restockedAt) {
    /*
     * Only *cancelled* is reversible, and the asymmetry is deliberate.
     * Un-cancelling is a seller correcting a mistake — the goods never left.
     * Refunding is not a mistake: the money went back and, ordinarily, so did
     * the goods, so tidying a refunded order to `completed` must not quietly
     * take the returned units off the shelf again.
     */
    retaken = await retakeStock(previous);
    await reinstateTicketsForOrder(input.orderId);
  }

  return { previous, status: input.status, restocked, retaken };
}

/* -------------------------------------------------------------------------- */
/*  Who else gets told                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What a status change means, as opposed to what it set.
 *
 * Every announcement below is guarded on one of these, and every one of them is
 * a question about the *transition*. "The seller has just cancelled this" and
 * "the seller re-saved a dropdown that already said cancelled" produce the same
 * row and are not the same event; firing on the second is how a customer
 * receives the same "your order was cancelled" message four times.
 *
 * A plain function over two values, so the rule can be read and tested without
 * a database — which matters because it is the half that was quietly wrong on
 * one of the two surfaces for as long as both existed.
 */
export type OrderTransition = {
  /** The seller has answered an appointment request that was still pending. */
  answeredBooking: boolean;
  /** Whether the answer was yes. Meaningless unless `answeredBooking`. */
  bookingAccepted: boolean;
  /** This call is the one that cancelled the order, not a re-save of it. */
  justCancelled: boolean;
};

export function orderTransition(
  previous: Pick<Order, "scheduledFor" | "status">,
  status: OrderStatus,
): OrderTransition {
  /*
   * A booked order stays `new` through payment — checkout tells the buyer the
   * shop confirms the slot afterwards — so moving it off `new` is the seller
   * answering, and moving it to `cancelled` is them declining.
   */
  const answeredBooking =
    Boolean(previous.scheduledFor) && previous.status === "new" && status !== "new";

  return {
    answeredBooking,
    bookingAccepted: status !== "cancelled",
    justCancelled: status === "cancelled" && previous.status !== "cancelled",
  };
}

/**
 * Where the caller's Next-shaped machinery plugs in.
 *
 * Both are optional and both default to doing the honest thing off-server,
 * because "off-server" is the mobile API and it must not be the degraded
 * caller. That was the bug: the webhooks were written at the one call site that
 * had `after()` and `revalidatePath()` to hand, so the surface without them
 * emitted nothing at all rather than emitting them plainly.
 */
export type OrderStatusHooks = {
  /**
   * Drops whatever the caller caches. `revalidatePath` needs Next's request
   * scope, which does not exist in `apps/api`, so it is handed in rather than
   * imported — and a phone, which caches none of the seller's pages, passes
   * nothing.
   */
  revalidate?: () => void;
  /**
   * Runs work after the response has gone. Next call sites pass `after`; with
   * no scheduler the task is awaited instead, which is slower and still
   * correct — what matters is that it runs *after* the write, not that the
   * caller stopped waiting.
   */
  defer?: (task: () => Promise<void>) => void;
};

export type OrderStatusResult = OrderStatusChange & {
  transition: OrderTransition;
};

/**
 * The status change plus everyone who has to hear about it. **Call this, not
 * `applyOrderStatus`.**
 *
 * Answers null on a missing order for the same reason the inner function does:
 * the caller knows whether that is a `NOT_FOUND` or a stale form post.
 */
export async function changeOrderStatus(
  input: { shop: Shop; orderId: string; status: OrderStatus },
  hooks: OrderStatusHooks = {},
): Promise<OrderStatusResult | null> {
  const change = await applyOrderStatus({
    shopId: input.shop.id,
    orderId: input.orderId,
    status: input.status,
  });
  if (!change) return null;

  const transition = orderTransition(change.previous, input.status);

  // Awaited when the caller has no scheduler — see `OrderStatusHooks.defer`.
  const settle = async (task: () => Promise<void>) => {
    if (hooks.defer) hooks.defer(task);
    else await task();
  };

  if (transition.justCancelled) {
    await settle(() =>
      emitOrderWebhook({
        shop: input.shop,
        event: "order.cancelled",
        orderId: input.orderId,
      }),
    );
  }

  /*
   * A declined booking is already an `order.cancelled` above, so it does not
   * also arrive as a confirmation. One event per thing that happened.
   */
  if (transition.answeredBooking && transition.bookingAccepted) {
    await settle(() =>
      emitOrderWebhook({
        shop: input.shop,
        event: "booking.confirmed",
        orderId: input.orderId,
      }),
    );
  }

  hooks.revalidate?.();

  return { ...change, transition };
}
