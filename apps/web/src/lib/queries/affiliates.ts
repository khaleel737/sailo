import "server-only";

/**
 * Moved to `@sailo/commerce/shop-views` — apps/hq's account page reads the same
 * three answers about somebody else's shop, and an app cannot import another
 * app. Re-exported so every caller in this app is unchanged.
 *
 * The `AffiliateRow` type came across with it and no caller here ever named it;
 * anything that wants it takes it from `@sailo/commerce/shop-views` directly.
 */
export { getShopAffiliates } from "@sailo/commerce/shop-views";

/* -------------------------------------------------------------------------- */
/*  Invoices                                                                   */
/* -------------------------------------------------------------------------- */
