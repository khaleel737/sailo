/**
 * Memberships, now in `@sailo/commerce/memberships`.
 *
 * The whole file moved rather than the two validators `products.save` needed.
 * Cherry-picking `BILLING_INTERVALS` and `normalizeTrialDays` out would have
 * left `addInterval`, `nextPeriodEnd` and `anyAccess` — every function that
 * operates on them — on the far side of a package boundary from the constants
 * they read, which is how two answers to "when does this renew" come to exist.
 */

export * from "@sailo/commerce/memberships";
