import type { Affiliate, Shop } from "@/db/schema";

/**
 * What an affiliate earns on an order, in basis points.
 *
 * Two rules meet here and the order matters. An affiliate may carry their own
 * rate, negotiated separately; falling back to the shop's default only when
 * they don't is what lets one person be paid differently from the rest.
 *
 * A null result means no commission accrues at all, which is not the same as
 * a rate of zero: zero is a rate the order records and reports on, null means
 * there is nobody to pay.
 */
export function commissionBpFor(
  affiliate: Affiliate | null,
  shop: Pick<Shop, "affiliateDefaultBp">,
): number | null {
  if (!affiliate) return null;
  return affiliate.commissionBp ?? shop.affiliateDefaultBp;
}
