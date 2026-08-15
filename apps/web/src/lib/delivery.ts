/**
 * The delivery rules, now in `@sailo/commerce/delivery`.
 *
 * Kept as a re-export for the nine files that import `@/lib/delivery`, exactly
 * as `lib/payments/rails.ts` is kept for its twenty-three.
 *
 * `shipsTo` is the reason a second copy would be dangerous rather than untidy:
 * the checkout panel narrows what a buyer may choose with it, the order action
 * re-checks with it, and now the seller's phone lists zones with it. Three
 * readings of "does this shop post here" that could disagree is a buyer being
 * offered a delivery the order will then refuse.
 */

export * from "@sailo/commerce/delivery";
