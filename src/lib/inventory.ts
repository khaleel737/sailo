import "server-only";
import { maybeRow } from "@/lib/invariant";
import { releaseCouponRedemption } from "@/lib/orders/coupon-redemption";
import { and, asc, eq, gte, inArray, isNull, isNotNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { releaseSlots, retakeSlots } from "@/lib/booking/claim";
import {
  bookingClaims,
  orderItems,
  orders,
  products,
  productVariants,
  type Order,
} from "@/db/schema";

/**
 * Stock movements. A null quantity means nobody is counting, and Postgres
 * carries that through arithmetic untouched — `null - 2` is still null — so
 * untracked rows fall out of these statements on their own.
 */

export type StockLine = {
  productId: string | null;
  variantId: string | null;
  quantity: number;
};

/**
 * Takes units off the shelf, or reports that they weren't there. The guard is
 * part of the WHERE clause rather than a read followed by a write, so two
 * buyers racing for the last one can't both be told yes.
 */
export async function reserveStock(input: {
  productId: string;
  variantId: string | null;
  quantity: number;
  trackInventory: boolean;
}): Promise<boolean> {
  if (!input.trackInventory || input.quantity <= 0) return true;
  const db = getDb();

  if (input.variantId) {
    const rows = await db
      .update(productVariants)
      .set({
        stockQuantity: sql`${productVariants.stockQuantity} - ${input.quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productVariants.id, input.variantId),
          or(
            isNull(productVariants.stockQuantity),
            gte(productVariants.stockQuantity, input.quantity),
          ),
        ),
      )
      .returning({ id: productVariants.id });
    return rows.length > 0;
  }

  const rows = await db
    .update(products)
    .set({
      stockQuantity: sql`${products.stockQuantity} - ${input.quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(products.id, input.productId),
        or(
          isNull(products.stockQuantity),
          gte(products.stockQuantity, input.quantity),
        ),
      ),
    )
    .returning({ id: products.id });
  return rows.length > 0;
}

/**
 * Puts units back, unconditionally. Used both to undo a half-reserved cart and
 * to restock a cancelled order — neither can be refused the way a purchase can.
 */
export async function releaseStock(line: StockLine) {
  const db = getDb();
  if (line.quantity <= 0) return;

  if (line.variantId) {
    /*
     * The same two conditions the product branch below applies, because
     * `reserveStock` never took these units in the first place: it returns
     * early for an untracked product, and a null count means nobody is
     * counting. Adding units back regardless drifts the number upward on
     * every cancel, refund and failed handoff — and the drift only becomes
     * visible the day a seller turns tracking on.
     *
     * Tracking lives on the parent product, so the variant is judged by it.
     */
    await db
      .update(productVariants)
      .set({
        stockQuantity: sql`${productVariants.stockQuantity} + ${line.quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productVariants.id, line.variantId),
          isNotNull(productVariants.stockQuantity),
          sql`exists (select 1 from ${products} where ${products.id} = ${productVariants.productId} and ${products.trackInventory})`,
        ),
      );
    return;
  }

  if (!line.productId) return;
  await db
    .update(products)
    .set({
      stockQuantity: sql`${products.stockQuantity} + ${line.quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(products.id, line.productId),
        eq(products.trackInventory, true),
        isNotNull(products.stockQuantity),
      ),
    );
}

/**
 * The lines an order took off the shelf. Falls back to the header columns for
 * rows written before orders could hold more than one product.
 */
async function stockLinesFor(order: Order): Promise<StockLine[]> {
  const items = await getDb().query.orderItems.findMany({
    where: eq(orderItems.orderId, order.id),
    orderBy: [asc(orderItems.position)],
  });

  if (items.length > 0) {
    return items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      quantity: i.quantity,
    }));
  }

  return [
    { productId: order.productId, variantId: order.variantId, quantity: order.quantity },
  ];
}

/**
 * Puts a cancelled or refunded order's units back. `restockedAt` is claimed in
 * the same statement that reads it, so a seller clicking twice — or cancelling
 * an order that was already refunded — can't restock it twice.
 */
export async function restoreStock(order: Order): Promise<boolean> {
  const db = getDb();

  const claimed = maybeRow(await db
    .update(orders)
    .set({ restockedAt: new Date() })
    .where(and(eq(orders.id, order.id), isNull(orders.restockedAt)))
    .returning({ id: orders.id }));
  if (!claimed) return false;

  /*
   * The appointment first, then the units.
   *
   * `restockedAt` is claimed above, so this function runs its cleanup exactly
   * once — which means anything that throws part-way leaves the rest undone
   * and a retry returns `false` without finishing it. Releasing the slot first
   * puts the cheapest and most consequential step where a later failure cannot
   * strand it: an appointment nobody can rebook is a shop's calendar blocked
   * permanently, while a unit not yet returned is a count the seller can see
   * and correct.
   */
  await releaseSlots(order.id);

  for (const line of await stockLinesFor(order)) {
    await releaseStock(line);
  }
  return true;
}

/**
 * Everything an order nobody will pay for has to give back.
 *
 * Four places abandon an order — the Stripe handoff failing, the session
 * expiring, a delayed payment failing to settle, and the sweep for buyers who
 * simply closed the tab. All four released the stock. Exactly one released the
 * coupon, so a one-use discount code was permanently spent by any buyer who
 * reached Stripe and walked away: their own retry was refused, and so was
 * everyone else's.
 *
 * `restoreStock` claims `restockedAt` in the statement that reads it and
 * returns false if another caller got there first. Hanging the coupon release
 * off that claim is what makes this safe to call twice — a webhook racing the
 * sweep gives the use back once, because only one of them wins.
 */
export async function abandonOrder(order: Order): Promise<boolean> {
  const claimed = await restoreStock(order);
  if (!claimed) return false;

  if (order.couponId) await releaseCouponRedemption(order.couponId);
  return true;
}

/** Undoes a restock, for a cancellation the seller reverses. */
export async function retakeStock(order: Order): Promise<boolean> {
  const db = getDb();

  const claimed = maybeRow(await db
    .update(orders)
    .set({ restockedAt: null })
    .where(and(eq(orders.id, order.id), isNotNull(orders.restockedAt)))
    .returning({ id: orders.id }));
  if (!claimed) return false;

  for (const line of await stockLinesFor(order)) {
    if (!line.productId) continue;
    // Deliberately unguarded: the seller is reversing their own decision, and
    // refusing to take the units back would leave the count too high.
    if (line.variantId) {
      await db
        .update(productVariants)
        .set({
          stockQuantity: sql`greatest(${productVariants.stockQuantity} - ${line.quantity}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(productVariants.id, line.variantId));
    } else {
      await db
        .update(products)
        .set({
          stockQuantity: sql`greatest(${products.stockQuantity} - ${line.quantity}, 0)`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(products.id, line.productId),
            eq(products.trackInventory, true),
            isNotNull(products.stockQuantity),
          ),
        );
    }
  }

  /*
   * The appointment comes back too, and unlike the units it can fail to.
   *
   * A seller un-cancelling an order is reversing their own decision, so the
   * stock above is taken back unguarded — but the calendar may have moved on:
   * somebody else can have booked that time in the meantime, and there is only
   * one of it. `retakeSlots` reports whether every slot was still free.
   *
   * The order is un-cancelled either way. Refusing the reversal would leave
   * the seller with an order they meant to reinstate and no way to say so; the
   * honest outcome is that it comes back and the double-booked time is a
   * conversation they can now see and have.
   */
  await retakeSlots(order);
  return true;
}

/** Statuses where the units are no longer going anywhere. */
export function isStockReleasingStatus(status: string) {
  return status === "cancelled" || status === "refunded";
}

/**
 * Gives back stock held by checkouts that were never paid for.
 *
 * Units come off the shelf when the order is written, before the money
 * arrives — otherwise two buyers racing for the last one can both be told yes.
 * The cost is that a buyer who opens a card checkout and wanders off is still
 * holding those units.
 *
 * `checkout.session.expired` normally hands them back, but that is a webhook,
 * and a webhook is a promise someone else keeps. An endpoint that was down for
 * an hour, a delivery Stripe gave up retrying, a session created while the app
 * was mid-deploy — any of those leaves stock reserved for a sale that will
 * never happen, with nothing to notice.
 *
 * So this sweeps rather than trusts. It is deliberately idempotent:
 * `restoreStock` claims `restockedAt` in the same statement it reads, so an
 * order that a webhook already handled is skipped rather than restocked twice.
 */
/**
 * How long an unanswered booking on a manual rail keeps its slot: three days.
 *
 * This is a judgement, not a derived number, and it is the only one in this
 * file — so it is worth saying what it is balancing. Too short cancels a real
 * appointment while the buyer's bank transfer is still clearing, which takes
 * one to three working days. Too long leaves a seller's calendar blockable by
 * anyone willing to book and not pay. Three days clears the slowest transfer
 * and still bounds the damage to a few days rather than indefinitely.
 *
 * A seller who wants a different answer already has a better one than a
 * number: confirming the booking removes it from the sweep for good.
 */
const BOOKING_HOLD_HOURS = 72;

export async function releaseAbandonedCheckouts(opts?: {
  /** How long a buyer gets to pay. Stripe expires its own sessions at 24h. */
  olderThanMinutes?: number;
  /** How long an unanswered booking holds its slot. See `BOOKING_HOLD_HOURS`. */
  bookingHoldHours?: number;
  shopId?: string;
}): Promise<{ swept: number; orderIds: string[] }> {
  const db = getDb();
  const cutoff = new Date(
    Date.now() - (opts?.olderThanMinutes ?? 24 * 60) * 60 * 1000,
  );

  const stale = await db.query.orders.findMany({
    where: and(
      /*
       * `unpaid` is the whole discriminator, and it only works because a
       * delayed method that has completed but not settled is moved to
       * `pending` by the webhook. Boleto takes three days; without that
       * promotion those orders sat here looking exactly like an abandoned
       * checkout and were cancelled with the buyer's money still in flight.
       */
      eq(orders.paymentStatus, "unpaid"),
      /*
       * The rail, not the session id.
       *
       * This used to require `stripeSessionId`, which is written only after
       * Stripe accepts the handoff — so an order that got as far as reserving
       * stock and never reached that write was invisible here forever, and
       * nothing else reclaims it. Matching on the rail catches those too,
       * while still leaving bank transfer and cash on delivery alone: those
       * are unpaid because the seller is waiting for money, not because the
       * buyer walked away.
       */
      eq(orders.paymentMethod, "card"),
      isNull(orders.restockedAt),
      lt(orders.createdAt, cutoff),
      ...(opts?.shopId ? [eq(orders.shopId, opts.shopId)] : []),
    ),
    limit: 200,
  });

  /*
   * Bookings that were never answered, on a rail nothing else reclaims.
   *
   * The query above matches on `card` because a manual order being unpaid is
   * not evidence of anything — the seller is waiting for a transfer, and only
   * they know whether it arrived. That reasoning holds for stock and fails for
   * a calendar. Units are fungible and visible: a seller can see the count is
   * wrong and fix it. A held appointment is a specific hour that silently
   * stops being bookable, and a shop's whole week can be taken by placing
   * bank-transfer bookings across it and never paying — the rate limit bounds
   * how fast, not whether.
   *
   * `new` is what makes this safe to do automatically. A booking deliberately
   * stays `new` through payment because checkout promises the buyer the shop
   * will confirm the time; the seller answering is a first-class step, not
   * bookkeeping. So an order that is still `new` is one nobody has answered,
   * and a seller who *has* answered has moved it to `confirmed`, which takes
   * it out of this query permanently. That includes the case this would
   * otherwise get wrong — a service paid at the appointment, booked weeks
   * out — because accepting it is the same click the buyer was already told
   * to expect.
   *
   * Paid bookings are never here: `unpaid` excludes them, so a buyer who paid
   * and is waiting on the seller keeps their slot however long that takes.
   */
  const bookingCutoff = new Date(
    Date.now() - (opts?.bookingHoldHours ?? BOOKING_HOLD_HOURS) * 60 * 60 * 1000,
  );
  const squatted = await db.query.orders.findMany({
    where: and(
      eq(orders.paymentStatus, "unpaid"),
      eq(orders.status, "new"),
      // Card is the query above's job, at its own much shorter cutoff.
      sql`${orders.paymentMethod} <> 'card'`,
      isNull(orders.restockedAt),
      lt(orders.createdAt, bookingCutoff),
      /*
       * Holding a slot is the entire reason to reclaim one of these, so ask
       * that directly rather than inferring it from `scheduledFor`. An order
       * whose claim is already gone needs nothing, and a manual order that
       * never booked anything is left alone — which keeps this from becoming
       * an expiry on unpaid orders generally, something no seller asked for.
       *
       * Uncorrelated on purpose. The relational query builder aliases the
       * table it is selecting from, so a hand-written `exists (... where
       * order_id = orders.id)` refers to a name that is not in scope there and
       * fails at parse time. Asking for the set of claimed order ids needs no
       * outer reference, and Postgres executes it as a hash semi-join anyway.
       */
      inArray(orders.id, db.select({ id: bookingClaims.orderId }).from(bookingClaims)),
      ...(opts?.shopId ? [eq(orders.shopId, opts.shopId)] : []),
    ),
    limit: 200,
  });

  const seen = new Set(stale.map((o) => o.id));
  const due = [...stale, ...squatted.filter((o) => !seen.has(o.id))];

  const orderIds: string[] = [];
  for (const order of due) {
    // Cancelled first: if restocking fails halfway the order still reads as
    // dead, which is the safer of the two wrong states.
    await db
      .update(orders)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(orders.id, order.id));

    // The sweep is one of the four abandonment paths, so it gives back the
    // coupon as well as the stock.
    if (await abandonOrder(order)) orderIds.push(order.id);
  }

  return { swept: orderIds.length, orderIds };
}
