/**
 * Which businesses Sailo accepts, which it accepts with conditions, and which
 * it declines.
 *
 * Three lists, one place, because the same policy is read by three different
 * people for three different reasons: a seller deciding whether to bother
 * signing up, a support reply explaining why a shop was closed, and a payment
 * provider or bank checking that we have a policy at all. Three copies of that
 * drift apart, and the one that drifts is always the one being quoted back at
 * us.
 *
 * ── WHY THIS LOOKS LIKE STRIPE'S LIST ────────────────────────────────────────
 * Card payments on Sailo are created on the seller's own Stripe connected
 * account, so Stripe's restricted-business list already binds every seller who
 * switches cards on, and the card networks' rules bind Stripe in turn. A
 * platform whose own policy is looser than its processor's is not more
 * permissive — it just tells sellers yes and lets Stripe tell them no later,
 * after they have built a catalogue. So the declined list below is deliberately
 * shaped like Stripe's, and where they differ the stricter one applies.
 *
 * One deliberate difference: this list holds on every channel. Most of Sailo's
 * orders arrive by chat, bank transfer or cash and never touch a payment system
 * at all, and a policy that only bound card sellers would decline a trade at
 * checkout while hosting a whole shop for it. Nothing here is switched off by
 * taking cash.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ── WHY IT IS ALSO A DIRECTORY, AND WHY HALF OF IT IS MACHINE-READABLE ───────
 * This was one file of prose. Prose is what a seller and a bank need, and it is
 * the half that cannot enforce anything: a published policy nobody screens
 * against is exactly what the card networks stopped accepting. Mastercard's
 * Merchant Monitoring Program standards from 1 January 2026 and Visa's VAMP
 * both push merchant screening earlier — a scan *before* the first transaction
 * and continuous monitoring after it — and that obligation lands on the whole
 * acquiring chain, which for Express connected accounts includes us. Stripe's
 * Connect Platform Agreement says the same thing in its own words: a platform
 * must take "all reasonable steps to ensure that connected accounts do not use
 * Services in violation" of the restricted-business list, and for accounts
 * onboarded through Express the platform is liable for what they do.
 *
 * So the policy is split by what reads it:
 *
 *   ./accepted       the two lists a seller reads to recognise themselves
 *   ./declined       the groups a support reply links to by anchor
 *   ./jurisdictions  the same question where the answer changes by country
 *   ./screen         the matcher, which is the enforcement half
 *
 * `screen` is the only one that runs on the money path. The rest render.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Not legal advice, and not a legal opinion about anybody's business. A shop
 * passing this list is not us saying the trade is lawful or licensed where the
 * seller is — that stays the seller's to establish, and the seller-obligations
 * clause of the terms says so.
 */

export {
  ACCEPTED_BUSINESSES,
  CONDITIONAL_BUSINESSES,
  type AcceptedBusiness,
  type ConditionalBusiness,
} from "./accepted";

export { DECLINED_BUSINESSES, type DeclinedGroup } from "./declined";

export {
  JURISDICTION_RULES,
  jurisdictionRulesFor,
  type JurisdictionRule,
  type JurisdictionStance,
} from "./jurisdictions";

export {
  screenBusiness,
  screeningTermCount,
  type ScreenInput,
  type ScreenMatch,
  type ScreenVerdict,
} from "./screen";

import { DECLINED_BUSINESSES } from "./declined";

/** Stripe's own list, which binds every seller taking card payments. */
export const STRIPE_RESTRICTED_URL = "https://stripe.com/legal/restricted-businesses";

/**
 * The date Stripe's list was last published when this policy was reconciled
 * against it.
 *
 * Here rather than in a comment because it is the one fact that decides whether
 * this file is current, and a date in a comment is a date nobody diffs. When
 * Stripe publishes a newer list, the job is to reconcile and then move this —
 * not to move this and then mean to reconcile.
 */
export const STRIPE_LIST_RECONCILED = "2026-05-13";

/**
 * Every declined item as one lowercase blob.
 *
 * Used by the tests to assert that categories the card networks require us to
 * exclude are still in the list after somebody edits it. Cheap to compute and
 * only ever called from a test, but it lives here so the shape of the data and
 * the thing that reads it stay together.
 */
export function declinedText(): string {
  return DECLINED_BUSINESSES.flatMap((g) => [g.group, g.why, ...g.items])
    .join(" ")
    .toLowerCase();
}
