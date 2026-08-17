import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import { runManualRenewals } from "@sailo/workflows/memberships";

/**
 * One pass of the manual renewal cycle.
 *
 * The card path has no equivalent route because Stripe *is* its cron: it
 * raises each invoice, charges the card and tells us. Every other rail has
 * nobody doing that, so this does — raising the next period's order a few days
 * before a membership lapses, and closing the ones nobody has paid for in
 * weeks.
 *
 * Daily rather than hourly. Nothing here is time-critical to the minute: the
 * lead is measured in days precisely because a bank transfer is, and a
 * renewal raised at 04:00 or 05:00 makes no difference to anyone. Running it
 * more often would only mean more chances to raise a duplicate — which the
 * claim prevents, but a claim that is never tested is a claim nobody trusts.
 *
 * Safe to run twice. Every renewal is claimed by a conditional UPDATE on the
 * period it is for, so an overlapping tick raises nothing.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const result = await runManualRenewals();

  return NextResponse.json({ ok: true, ...result });
}
