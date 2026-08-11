import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { maybeRow } from "@/lib/invariant";

/**
 * Taking a slice of an order's refundable balance, and giving it back.
 *
 * `checkRefund` decides whether a refund *may* happen. That decision is a read
 * and nothing more, so two sellers — or one seller double-clicking, or a
 * retried request — both pass it holding the same snapshot. Claiming is the
 * separate act of taking the amount, and it is the only place the ceiling is
 * actually enforced. Exactly the shape `claimCouponRedemption` already has,
 * for exactly the same reason.
 *
 * The bug this closes is the concurrent half of a defect whose sequential half
 * was fixed earlier: `refundedCents` accumulated correctly one refund at a
 * time, but the total was computed in JavaScript from a row read before a
 * network call to Stripe and written back with no guard. Two $50 refunds on a
 * $100 order issued in the same second both passed the check, both moved money
 * at Stripe — each is within the original charge, so nothing there objects —
 * and the second write overwrote the first with the same $50. $100 left the
 * seller's balance, the column read $50, and no screen showed the difference.
 *
 * The claim happens **before** the processor is called, not after. Claiming
 * afterwards would leave the same gap: the point is that the second caller
 * must be refused before it can move any money.
 */
export async function claimRefundAmount(
  orderId: string,
  shopId: string,
  requestedCents: number,
): Promise<{ refundedTotal: number } | null> {
  if (requestedCents <= 0) return null;

  const claimed = maybeRow(
    await getDb()
      .update(orders)
      .set({
        refundedCents: sql`${orders.refundedCents} + ${requestedCents}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, orderId),
          // Ownership in the same statement as the claim, so this is safe to
          // call without a prior read having proved it.
          eq(orders.shopId, shopId),
          /*
           * The ceiling is read from the columns, not from the row the caller
           * is holding — the same argument the coupon claim spells out. A
           * snapshot of `totalCents` and `refundedCents` taken before the
           * Stripe call is precisely what a concurrent refund invalidates.
           */
          sql`${orders.refundedCents} + ${requestedCents} <= ${orders.totalCents}`,
        ),
      )
      /*
       * The post-claim balance, which is the only trustworthy answer to "is
       * this order now fully refunded".
       *
       * The caller used to decide that from the row it read *before* the
       * claim, so two partial refunds that between them consumed the whole
       * balance each saw themselves as partial — and neither restocked, nor
       * moved the order to `refunded`. A fully refunded order sat there
       * looking paid and active. The statement that accumulates the amount is
       * the one that knows the total, so it returns it.
       */
      .returning({ refundedTotal: orders.refundedCents, total: orders.totalCents }),
  );

  return claimed ? { refundedTotal: claimed.refundedTotal } : null;
}

/**
 * Puts a claimed amount back when the processor refused it.
 *
 * Without this a failed Stripe call would permanently consume part of the
 * order's refundable balance: the seller would be told the reversal failed and
 * then be unable to retry it, because the column already counted the attempt.
 *
 * `GREATEST(…, 0)` so a double release — a retry racing an error path — cannot
 * drive the column negative and hand the order back more balance than it ever
 * had.
 */
export async function releaseRefundClaim(
  orderId: string,
  requestedCents: number,
): Promise<void> {
  await getDb()
    .update(orders)
    .set({
      refundedCents: sql`GREATEST(${orders.refundedCents} - ${requestedCents}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));
}
