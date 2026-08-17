/**
 * Why a payout was refused, in words HQ can act on.
 *
 * Its own module because every screen and every run reads the same sentence for the same
 * refusal. Two copies of "their Stripe account isn't finished verifying" is how HQ and the
 * portal end up telling a partner different things about the same blocked payout.
 */

import "server-only";
import { type PayoutBlocker } from "../eligibility";

/**
 * Why a payout was refused, in words HQ can act on.
 *
 * Every one of these is an ordinary state a run meets several times a month
 * and none is an error — a refusal names what the seller has to finish, and
 * the run moves to the next partner.
 */
export const PAYOUT_BLOCKED: Record<PayoutBlocker, string> = {
  no_shop: "They have no shop — the programme is for active sellers.",
  no_stripe: "Their shop hasn't connected Stripe yet.",
  stripe_incomplete: "Their Stripe account isn't finished verifying.",
};
