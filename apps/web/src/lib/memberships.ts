/**
 * Memberships, now in `@sailo/core/memberships`.
 *
 * Kept as a re-export for the reason `@/lib/plans` is: the modules that import
 * `@/lib/memberships` are not what changed.
 *
 * The whole file moved rather than the two validators `products.save` needed.
 * Cherry-picking `BILLING_INTERVALS` and `normalizeTrialDays` out would have
 * left `addInterval`, `nextPeriodEnd` and `anyAccess` — every function that
 * operates on them — on the far side of a package boundary from the constants
 * they read, which is how two answers to "when does this renew" come to exist.
 * It imports only types from `@sailo/db/schema`, so nothing followed it.
 */

export * from "@sailo/core/memberships";
