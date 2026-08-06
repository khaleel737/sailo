import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { coupons, type Coupon } from "@/db/schema";
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
          coupon.maxRedemptions === null
            ? undefined
            : lt(coupons.timesRedeemed, coupon.maxRedemptions),
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
