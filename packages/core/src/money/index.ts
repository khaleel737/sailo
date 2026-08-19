/**
 * Money, and the arithmetic that must give the same answer everywhere.
 *
 * `currency` knows each currency's minor unit — the reason a ¥1,000 product was
 * once stored as ¥100,000 and charged. `pricing` and `quote` turn a basket into
 * a total. `tax-label` names what was added and to whom.
 *
 * All four are pure and all four are bundled into the phone, which is the
 * constraint that keeps them here rather than in `@sailo/commerce`: a seller
 * confirming a cash sale at a market stall has to arrive at the same number the
 * storefront quoted.
 */
export * from "./currency";
export * from "./regional";
export * from "./pricing";
export * from "./quote";
export * from "./tax-label";
/** What a parcel weighs, and what that costs to post — spec 51. */
export * from "./weight";
