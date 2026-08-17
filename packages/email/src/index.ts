/**
 * Every message Sailo sends, grouped by who receives it and why.
 *
 * WHY BY AUDIENCE
 *
 * These were one 810-line `messages.ts` inside `apps/web`, which meant two
 * things at once: `packages/api` could not send any of them — so the phone
 * could change an order's status but not refund one, because a refund ends by
 * telling the buyer — and nothing in the file distinguished a receipt from a
 * password reset from a marketing opt-in. Those three have different legal
 * standing, different urgency and different rules about consent, and a grouping
 * that hides the difference is how an unsubscribe link ends up on a receipt.
 *
 *   ./transactional  a buyer's record of a purchase. No consent, no
 *                    unsubscribe: a buyer cannot opt out of being told their
 *                    order shipped.
 *   ./shop           what a seller and their partners are told about the shop.
 *   ./system         account and security. Never batched, never throttled,
 *                    never subject to a preference.
 *   ./lifecycle      mail that had to ask first.
 *
 * WHAT LEFT, AND WHY
 *
 * `transport` and `markup` are `@sailo/mailer` now. They were here, and holding
 * them forced three other domain packages into a sibling dependency on this one:
 * `@sailo/marketing` wanted `layout` and `sendBatch` to compose a broadcast,
 * `@sailo/security` wanted them to email the staff about a blocklisting, and
 * `@sailo/webhooks` wanted them to tell a seller it had disabled their endpoint.
 * None of the three wants an order receipt, and all three had to depend on the
 * package that holds one.
 *
 * A Resend client and a set of HTML table helpers are a *capability*. The
 * messages — which know about orders, shops and sellers — are domain. Split, the
 * three reach downwards for the capability instead of sideways for this package.
 *
 * Still re-exported from here, because a caller that composes and sends a message
 * in one function should not have to name two packages to do it.
 */

export * from "@sailo/mailer";
/*
 * Re-exported, not owned. `origin` moved to `@sailo/core/origin` when
 * `@sailo/commerce` needed the same base to build a Stripe return URL from —
 * two packages reading `NEXT_PUBLIC_APP_URL` through two different helpers is
 * how one of them ends up mailing links to localhost.
 */
export { appOrigin, absolute } from "@sailo/core/origin";
