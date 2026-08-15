/**
 * Mail, in the two halves that two apps both need.
 *
 * WHY THIS PACKAGE EXISTS
 *
 * `apps/web/src/lib/email` composed and sent every message Sailo produces, and
 * `packages/api` cannot import from an app — so the phone could change an
 * order's status and could not refund one, because a refund ends by telling the
 * buyer and there was no way to reach the sender. `orders.updateStatus` has
 * carried a note about that gap since it was written, naming this package as
 * the work order that closes it.
 *
 * WHAT MOVED AND WHAT DID NOT
 *
 * The transport and the markup moved whole: both are about *how mail is made
 * and sent*, which is the same on every surface. The messages themselves are
 * moving one path at a time, starting with the order lifecycle, because each
 * one has to be re-pointed at shared versions of the things it names — the
 * money formatter, the address formatter, the order's own lines.
 *
 * `lifecycle-messages.ts` and the support and marketing messages are staying in
 * apps/web. They reach into the marketing site's own content — a hero demo, the
 * support topic list, SEO metadata — and none of that is a thing a phone sends.
 */

export * from "./transport";
export * from "./markup";
export { APP_URL, absolute } from "./origin";
