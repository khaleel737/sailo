/**
 * Mail that needs permission first.
 *
 * One message: the double opt-in confirmation that turns an address typed into
 * a storefront form into a subscriber. It is the boundary between transactional
 * and marketing mail — a receipt goes to whoever bought, and everything past
 * this goes only to whoever said yes.
 *
 * WHY THE ONBOARDING DRIP IS NOT HERE
 *
 * It briefly was, and it made `@sailo/email` and `@sailo/marketing` import each
 * other: composing a drip message needs to know which step a shop is on, and
 * deciding to send one needs the message. The composer is inseparable from the
 * state machine that selects it, so it lives with the state machine —
 * `@sailo/marketing/lifecycle` — and reaches back for `../markup` and
 * `../transport` the same way `@sailo/commerce` reaches for `@sailo/email/shop`.
 *
 * The rule that falls out: this package owns *how mail is made and sent*.
 * Anything that has to ask the database what to say belongs with whatever knows
 * the answer.
 */
export * from "./subscribe";
