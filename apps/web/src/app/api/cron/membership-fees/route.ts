import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import { reconcileMembershipFees } from "@sailo/workflows/memberships/fees";

/**
 * One pass of the membership fee sweep.
 *
 * Sailo's cut of a membership was set from the seller's plan on the day the
 * member subscribed and never revisited, so it drifted the moment the seller
 * changed tier -- upward for anyone who upgraded, which is the direction that
 * quietly overcharges the sellers paying us most. This puts every card
 * membership back on the rate its shop's plan actually promises.
 *
 * Hourly, and its own route rather than a second job inside
 * `/api/cron/memberships`. That one is daily because a bank transfer takes
 * days; this one is bounded by something else entirely -- Stripe finalises a
 * subscription invoice about an hour after raising it, and the fee is read at
 * finalisation. An hour is the window inside which a plan change has to reach
 * Stripe to be certain of catching the next renewal, so an hour is the tick.
 *
 * Cheap when there is nothing to do: an index-only scan and one query per shop
 * that sells card memberships, and no Stripe call at all unless a row
 * disagrees with its plan.
 *
 * Safe to run twice. Every write asks Stripe for the value the plan implies,
 * so an overlapping tick sets the same number again and changes nothing.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const result = await reconcileMembershipFees();

  return NextResponse.json({ ok: true, ...result });
}
