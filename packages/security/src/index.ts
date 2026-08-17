/**
 * The checks that decide whether a request, a sender or a person is allowed.
 *
 * WHY THESE FIVE ARE ONE PACKAGE
 *
 * They were five unrelated-looking files in `apps/web/src/lib` and one folder,
 * and what they have in common is not their subject but their consequence:
 * each one is the only thing standing between an open signup and an abuse.
 *
 *   ./blocklist              is our sending reputation intact?
 *   ./ip-ranges              is this address one a webhook may be sent to?
 *   ./restricted-businesses  is this a trade we are allowed to serve?
 *   ./staff                  may this address reach the internal surfaces?
 *   ./cron-auth              did this scheduled request really come from us?
 *
 * `ip-ranges` is the one whose absence is hardest to notice and worst to lose.
 * A seller supplies the URL an outbound webhook is posted to, so without it the
 * platform is a request forger: point it at a metadata endpoint and read the
 * reply. It sits here rather than beside the webhook sender because the same
 * question — "is this address private?" — is asked of a calendar feed URL too.
 *
 * next-forge puts Arcjet here. This is the same slot, with the checks Sailo
 * already had rather than a vendor; adding one later means adding it behind
 * these names.
 */
export * from "./blocklist";
export * from "./restricted-businesses";
export * from "./staff";
export * from "./cron-auth";
