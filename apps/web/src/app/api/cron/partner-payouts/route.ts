import { cronAuthFailure } from "@sailo/security/cron-auth";
import { getProgramSettings } from "@sailo/partners/settings";
import { reconcilePendingPayouts, runPayouts } from "@sailo/partners/payouts";

/**
 * The monthly partner payout run.
 *
 * Scheduled daily and gated on the *settings*, not on the cron expression. The
 * payout day is something /hq can change without a deploy, and a schedule that
 * lived only in `vercel.json` would mean the setting screen offered a control
 * that did nothing. So this fires every morning, checks whether today is the
 * day, and mostly does nothing.
 *
 * Reconciliation is the exception: it runs every day regardless. A payout left
 * `pending` is one where we called Stripe and never learned the outcome, and
 * that is not a thing to leave sitting for a month — it is either money we owe
 * and haven't sent, or money we've sent and haven't recorded.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const refused = cronAuthFailure(request);
  if (refused) return refused;

  /*
   * First, always: resolve anything left in flight. Re-sending with the stored
   * idempotency key is safe — Stripe replays the original response for a
   * repeated key, so a transfer that already went through is recorded rather
   * than duplicated.
   */
  const reconciled = await reconcilePendingPayouts();

  const settings = await getProgramSettings();
  const today = new Date().getUTCDate();

  if (!settings.autoPayout) {
    return Response.json({
      ran: false,
      reason: "automatic payouts are switched off",
      reconciled,
    });
  }

  if (today !== settings.payoutDayOfMonth) {
    return Response.json({
      ran: false,
      reason: `payouts run on day ${settings.payoutDayOfMonth}, today is ${today}`,
      reconciled,
    });
  }

  const run = await runPayouts({ initiatedBy: "auto" });

  /*
   * Failures are logged rather than thrown. A partner whose transfer bounced —
   * an unfinished Connect account, a short platform balance — must not stop
   * the run reaching everyone after them, and `runPayouts` already put their
   * earnings back in the pool for next month.
   */
  for (const result of run.results) {
    if (!result.ok) {
      console.error(
        `[sailo] partner payout failed for ${result.partnerName}: ${result.reason}`,
      );
    }
  }

  return Response.json({
    ran: true,
    reconciled,
    paid: run.paid,
    failed: run.failed,
    skipped: run.skipped,
    totalCents: run.totalCents,
  });
}
