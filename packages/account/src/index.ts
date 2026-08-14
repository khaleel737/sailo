/**
 * The seller's own account, as opposed to their shop: which emails they want,
 * and leaving.
 *
 * `deletion` is deliberately *not* re-exported here. It opens `server-only`
 * and reaches for Stripe, a blob store and half the schema, and folding it in
 * would put all of that in front of the settings card that only wants to know
 * whether a switch is on. Import it from `@sailo/account/deletion`.
 */

export * from "./notification-prefs";
