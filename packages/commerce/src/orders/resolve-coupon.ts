import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { coupons, type Coupon } from "@sailo/db/schema";
import { checkCoupon, COUPON_MESSAGES, normalizeCode } from "@sailo/core/pricing";
import { couponAtCurrency } from "@sailo/core/regional";

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
  /**
   * What the order is priced in, and the shop's own — spec 53.
   *
   * A **percentage** coupon needs nothing here: 10% off is 10% off in any
   * currency. Only a fixed amount, or a minimum subtotal, is a number in a
   * currency, and one without a price in this order's currency is refused
   * rather than converted — a `€5` code that takes five off whatever the buyer
   * happens to be paying in is a discount nobody set.
   */
  money?: { currency: string; shopCurrency: string };
}): Promise<CouponResult> {
  if (!opts.code?.trim()) return { ok: true, coupon: null };

  const code = normalizeCode(opts.code);
  const row = await getDb().query.coupons.findFirst({
    where: and(eq(coupons.shopId, opts.shopId), eq(coupons.code, code)),
  });

  /*
   * Re-read in the order's currency **before** the verdict, so the minimum
   * subtotal is checked against the number the buyer is actually spending.
   * Checking first and converting after would qualify a €40 basket against a
   * $50 floor.
   *
   * A row that cannot be quoted becomes no row, which reaches `checkCoupon` as
   * `not_found` and comes back as the same sentence every other unusable code
   * gets. That is deliberate: a code that exists but is not priced in euros
   * must not answer differently from one that does not exist, or the checkout
   * is an oracle for which codes a shop has.
   */
  const found = opts.money && row
    ? (couponAtCurrency(row, opts.money.currency, opts.money.shopCurrency) ?? undefined)
    : row;

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
