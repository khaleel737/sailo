import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, type Order } from "@sailo/db/schema";
import type { OrderStatus } from "@sailo/core/order-status";
import { isStockReleasingStatus, restoreStock, retakeStock } from "./inventory";
import { reinstateTicketsForOrder, voidTicketsForOrder } from "./tickets";

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
 * What is deliberately *not* here: the confirmation email, the outbound
 * webhook, and the cache revalidation. Those are apps/web's, they need a
 * `Shop` row and Next's request scope, and each caller adds the ones it can —
 * see the note on the mobile procedure in `@sailo/api`, which currently adds
 * none of them.
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
