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
export * from "@sailo/commerce/ticketing";

/*
 * The customer roster moved to `@sailo/customers/roster` — the broadcast
 * composer picks an audience from it, and that now lives in `@sailo/marketing`,
 * which cannot reach into this app. Re-exported so the four screens that read
 * it here are unchanged.
 */
export * from "@sailo/customers/roster";
