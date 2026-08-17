/**
 * Who may earn, and where their money goes.
 *
 * Both answers now come from the partner's *shop*, and that is the whole
 * design. A partner must be an active paying seller, so by the time they can
 * earn anything they already have a Stripe account connected — the one their
 * own buyers pay into. Commission goes there.
 *
 * ## What this replaced
 *
 * A partner used to onboard a *second* Stripe account: a transfers-only
 * `recipient` account with its own service-agreement rules, its own country
 * picker, its own cross-border zone, its own six columns on `partners`, and a
 * hand-payment fallback for everyone it could not reach. About nine hundred
 * lines, all of it solving a problem this file makes impossible — a partner
 * with nowhere to be paid. If they can take money from a customer, they can
 * take money from us.
 *
 * The cross-border question dissolves for the same reason. We are not choosing
 * a country for a new account; we are transferring to an account Stripe
 * already approved for this seller in their own country.
 */

import type { PartnerStatus } from "./program";
import { canEarn } from "./program";

/**
 * The shop columns every decision here reads.
 *
 * Spelled out rather than imported from the schema so the pure functions below
 * stay callable from a test with an object literal, and so it is obvious at a
 * glance how small the surface actually is.
 */
export type EarningShop = {
  plan: string;
  subscriptionStatus: string | null;
  compPlan: string | null;
};

export type PayoutShop = EarningShop & {
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
};

/**
 * Whether this shop's subscription is currently live.
 *
 * `active` and `trialing` both count. A trial is someone Stripe is about to
 * charge, and refusing to attribute their referrals would mean a partner loses
 * a signup for being fourteen days early.
 *
 * `past_due` deliberately does not count. Stripe is still retrying, so the
 * money may yet arrive — but until it does we are paying commission out of
 * revenue we have not received, which is the one direction this must never
 * lean.
 *
 * A comped plan counts with no Stripe subscription at all: those are beta
 * users and friends of the house, and the point of comping someone is that
 * they get the product without paying for it.
 */
export function hasLiveSubscription(shop: EarningShop | null | undefined): boolean {
  if (!shop) return false;
  if (shop.compPlan && shop.compPlan !== "free") return true;
  if (shop.plan === "free") return false;
  return shop.subscriptionStatus === "active" || shop.subscriptionStatus === "trialing";
}

/**
 * Whether a partner may accrue new commission right now.
 *
 * Two conditions, both current rather than historical: the partner is approved
 * and the subscription is live. Checked at every `invoice.paid` rather than
 * once at approval, because a partner who cancels stops earning from that
 * moment — that is the rule, and a rule enforced only at signup is not one.
 *
 * What it deliberately does *not* do is touch money already earned. A lapsed
 * partner stops accruing and still gets paid what the ledger already owes
 * them; see `canBePaid`, which has no subscription test at all.
 */
export function canAccrue(
  status: PartnerStatus | string,
  shop: EarningShop | null | undefined,
): boolean {
  return canEarn(status) && hasLiveSubscription(shop);
}

/**
 * Whether we can actually send this partner their balance.
 *
 * **No subscription check, on purpose.** Commission already in the ledger was
 * earned under the terms that applied when the invoice was paid, and a partner
 * who cancels next month did not un-earn it. Cancelling stops the tap; it does
 * not empty the bucket.
 *
 * `stripeChargesEnabled` is the readiness signal rather than a transfers-only
 * capability, because this is the seller's own account: if Stripe will let
 * them charge their customers, the account is verified, and a verified
 * connected account takes transfers. Reusing the signal the seller dashboard
 * already shows also means a partner is never told they are payable on one
 * screen and unpayable on another.
 */
export function canBePaid(shop: PayoutShop | null | undefined): boolean {
  if (!shop) return false;
  return Boolean(shop.stripeAccountId) && shop.stripeChargesEnabled;
}

/**
 * Why a partner cannot be paid, for the one place that has to explain it.
 *
 * Returns null when they can. Each reason names the thing the partner or HQ
 * has to *do*, because "not payable" on its own has sent people to support who
 * only needed to finish a Stripe form.
 */
export type PayoutBlocker =
  | "no_shop"
  | "no_stripe"
  | "stripe_incomplete";

export function payoutBlocker(shop: PayoutShop | null | undefined): PayoutBlocker | null {
  if (!shop) return "no_shop";
  if (!shop.stripeAccountId) return "no_stripe";
  if (!shop.stripeChargesEnabled) return "stripe_incomplete";
  return null;
}
