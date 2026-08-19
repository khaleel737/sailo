import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import {
  claimDuePlatformDisputes,
  sendDueDisputeReminders,
} from "@sailo/workflows/disputes";
import { captureMessage } from "@sailo/observability";

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

  /*
   * And the desk's own deadline — spec 46.
   *
   * A platform dispute has no seller to email: Sailo is the merchant of record,
   * and the person who has to act is on shift here. Same four-day window, same
   * conditional-update claim on its own column, and the channel is the one staff
   * already watch. Without it the desk's deadline would be the single thing in
   * this subsystem nobody was reminded about — which is how a case that was
   * worth winning becomes an uncontested loss on the platform's own rate.
   */
  const platform = await claimDuePlatformDisputes();
  for (const row of platform) {
    captureMessage(
      `Sailo's own chargeback ${row.stripeDisputeId} is due ` +
        `${row.dueBy?.toISOString().slice(0, 10) ?? "soon"} and has not been answered. ` +
        `${(row.deductedCents / 100).toFixed(2)} ${row.currency}, ${row.reason}. ` +
        `Open /hq/disputes/${row.id} — the evidence is assembled and the three ` +
        `decision questions are answered there.`,
      "warning",
    );
  }

  return NextResponse.json({ ok: true, ...result, platformNoticed: platform.length });
}
