import "server-only";

/**
 * Moved to `@sailo/commerce/shop-views` — apps/hq's account page reads the same
 * three answers about somebody else's shop, and an app cannot import another
 * app. Re-exported so every caller in this app is unchanged.
 */
export type { AffiliateRow } from "@sailo/commerce/shop-views";
export { getShopAffiliates } from "@sailo/commerce/shop-views";

/* -------------------------------------------------------------------------- */
/*  Invoices                                                                   */
/* -------------------------------------------------------------------------- */
