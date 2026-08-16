/**
 * Mail that needs permission first.
 *
 * Today: the double opt-in confirmation that turns an address typed into a
 * storefront form into a subscriber. The onboarding drip in
 * `apps/web/src/lib/email/lifecycle-messages.ts` joins it once the lifecycle
 * state machine it reads leaves the app — it asks which step a shop is on, and
 * that is a marketing question rather than a mail one.
 */
export * from "./subscribe";
