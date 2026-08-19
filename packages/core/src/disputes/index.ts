/*
 * Chargebacks: what a dispute is, what answers it, and what to do about a shop
 * that keeps producing them.
 *
 * Everything here is pure. No database, no Stripe, no clock that was not passed
 * in — which is deliberate for a subsystem whose paths run a handful of times a
 * month and whose mistakes are discovered as a debited balance sixty days later.
 *
 * The layers above:
 *   `@sailo/payments/disputes`  the Stripe seam — submit, deduct, hold payouts
 *   `@sailo/commerce/disputes`  the rows — record a dispute, gather holdings
 */

export * from "./lifecycle";
export * from "./reasons";
export * from "./rate";
export * from "./escalation";
export * from "./assemble";
export * from "./ce3";
export * from "./platform";
export * from "./pack";
export * from "./files";

/* Spec 44 — capturing what a dispute is answered with. */
export * from "./descriptor";
export * from "./policy";
export * from "./messages";
