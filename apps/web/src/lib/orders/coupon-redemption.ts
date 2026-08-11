import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { coupons, type Coupon } from "@sailo/db/schema";
import { maybeRow } from "@/lib/invariant";

/**
 * Taking a coupon's last use, and giving it back.
 *
 * `resolveCoupon` decides whether a code *may* be used. That decision is a read
 * and nothing more, so two buyers holding the last use of a one-time code both
 * pass it. Claiming is the separate act of taking it, and it is the only place
 * the cap is actually enforced.
 */

/**
 * Takes one redemption, if there is one left.
 *
 * The check and the increment are the same statement. They have to be: a read
 * of `timesRedeemed` followed by a write of `timesRedeemed + 1` is two
 * statements with a gap, and the gap is exactly wide enough for a second order
 * to read the same number. The previous code carried a comment claiming this
 * was atomic while doing precisely that, so a one-use code could be redeemed
 * by however many buyers happened to click at once.
 *
 * A null `maxRedemptions` means unlimited, which is not the same as zero — the
 * clause is dropped rather than compared against.
 */
export async function claimCouponRedemption(coupon: Coupon): Promise<boolean> {
  const claimed = maybeRow(
    await getDb()
      .update(coupons)
      .set({ timesRedeemed: sql`${coupons.timesRedeemed} + 1` })
      .where(
        and(
          eq(coupons.id, coupon.id),
          /*
           * The cap is read from the column, not from the row the caller is
           * holding.
           *
           * `resolveCoupon` read that row earlier in the checkout, so its
           * `maxRedemptions` is a snapshot. Baking it in as a literal made the
           * statement atomic against a number that may already be stale: a
           * seller raising the cap mid-checkout would still see in-flight
           * buyers refused against the old limit, and lowering it would let
           * claims through above the new one. Comparing column to column is
           * the only version that enforces the cap as it stands.
           *
           * A NULL cap means unlimited, and `<` against NULL is NULL — never
           * true — so it has to be spelled out rather than left to the
           * comparison.
           */
          sql`(${coupons.maxRedemptions} is null or ${coupons.timesRedeemed} < ${coupons.maxRedemptions})`,
        ),
      )
      .returning({ id: coupons.id }),
  );

  // No row means the cap was reached between the buyer's check and this
  // claim — an answer, not a failure.
  return Boolean(claimed);
}

/**
 * Gives a claimed redemption back.
 *
 * Called when the payment handoff fails after the claim. Without it the code
 * is spent on an order that was rolled back, and the buyer who paid for that
 * discount can never use it again.
 *
 * `greatest(… - 1, 0)` because a counter that has already been reset by the
 * seller must not be driven negative by a late release.
 */
export async function releaseCouponRedemption(couponId: string): Promise<void> {
  await getDb()
    .update(coupons)
    .set({ timesRedeemed: sql`greatest(${coupons.timesRedeemed} - 1, 0)` })
    .where(eq(coupons.id, couponId));
}
