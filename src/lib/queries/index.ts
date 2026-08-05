/**
 * Reads, grouped by what they read.
 *
 * `@/lib/queries` still resolves here, so no consumer changed. Writes live in
 * `lib/actions` — nothing in this folder mutates.
 */

export * from "./shop";
export * from "./products";
export * from "./analytics";
export * from "./orders";
export * from "./checkout";
export * from "./coupons";
export * from "./affiliates";
export * from "./invoices";
export * from "./reviews";
