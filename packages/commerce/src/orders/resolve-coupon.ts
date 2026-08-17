import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { coupons, type Coupon } from "@sailo/db/schema";
import { checkCoupon, COUPON_MESSAGES, normalizeCode } from "@sailo/core/pricing";

/**
 * Looking up a discount code and deciding whether it applies.
 *
 * The lookup and the verdict belong together: `checkCoupon` reports
 * `not_found` for a missing row, so a caller holding them apart has to prove
 * twice that the same coupon exists.
 */

export type CouponResult =
  | { ok: true; coupon: Coupon | null }
  | { ok: false; error: string };

export async function resolveCoupon(opts: {
  shopId: string;
  /** Whatever the buyer typed. Blank means they didn't use one. */
  code: string | undefined;
  subtotalCents: number;
  now: Date;
}): Promise<CouponResult> {
  if (!opts.code?.trim()) return { ok: true, coupon: null };

  const code = normalizeCode(opts.code);
  const found = await getDb().query.coupons.findFirst({
    where: and(eq(coupons.shopId, opts.shopId), eq(coupons.code, code)),
  });

  const verdict = checkCoupon(found, opts.subtotalCents, opts.now);
  if (!verdict.ok || !found) {
    // The two conditions are one: a passing verdict already implies a row.
    // Testing both is what lets the return below stand without an assertion.
    return {
      ok: false,
      error: verdict.ok
        ? COUPON_MESSAGES.not_found
        : COUPON_MESSAGES[verdict.reason],
    };
  }

  return { ok: true, coupon: found };
}
