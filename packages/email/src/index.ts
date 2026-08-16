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
 * The two halves underneath are shared by all four and stay at the root:
 * `./transport` (how mail leaves) and `./markup` (what it is made of).
 */

export * from "./transport";
export * from "./markup";
export { APP_URL, absolute } from "./origin";
