import "server-only";

/** Discount codes. */

/**
 * The shop's coupons, newest first.
 *
 * `@sailo/commerce/coupons`'s, not a second query. This was the same four lines
 * — same table, same predicate, same order — written here and there, which is
 * two answers to "what coupons does this shop have" waiting to disagree the
 * first time one of them learns about expiry or archiving.
 */
export { listCoupons as getShopCoupons } from "@sailo/commerce/coupons";

/* -------------------------------------------------------------------------- */
/*  Affiliates                                                                 */
/* -------------------------------------------------------------------------- */
