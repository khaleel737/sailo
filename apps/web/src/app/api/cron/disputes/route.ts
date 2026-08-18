import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import { sendDueDisputeReminders } from "@sailo/workflows/disputes";

/**
 * "Your chargeback deadline is close, and this is still missing."
 *
 * The opening email goes out from the webhook, the moment the bank tells us.
 * This is the second half of the same job: about twenty days is long enough to
 * read that mail, mean to deal with it, and forget — and the evidence that wins
 * a case is usually a document only the seller has.
 *
 * Hourly rather than every fifteen minutes. The unit here is a *day*, not a
 * minute: the sweep looks four days ahead, so the worst a slow tick costs is an
 * hour of a four-day warning. `/api/cron/reminders` runs four times as often
 * because a one-hour event reminder genuinely needs it.
 *
 * Running it twice is harmless. Every send is claimed with a conditional update
 * that only one caller can win, so a replay — or two instances ticking together
 * — claims nothing and mails nobody.
 */
export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const result = await sendDueDisputeReminders();

  return NextResponse.json({ ok: true, ...result });
}
