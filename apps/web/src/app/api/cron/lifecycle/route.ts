import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import { runLifecyclePass } from "@sailo/marketing/lifecycle/server";

/**
 * One tick of Sailo's own lifecycle mail — the onboarding and activation
 * pipeline that goes to sellers about Sailo, not to buyers about a shop.
 *
 * Hourly, and the hour is a compromise between two rungs pulling opposite
 * ways. "Your shop is live" is worth almost nothing a day late, so a nightly
 * job is too slow for it; and marketing mail should not be attempted every
 * five minutes, because the pass reads a page of accounts each time and
 * almost all of them will have nothing due. The per-seller pacing gate inside
 * `runLifecyclePass` is what actually decides frequency — this only decides
 * how promptly a rung that has come due goes out.
 *
 * Safe to run twice, and that is a property of the claim rather than of the
 * schedule: each email is claimed by an INSERT whose unique index on (user,
 * step) picks one winner, so an overlapping tick, a retry, or a hand-run
 * against production claims nothing and mails nobody.
 *
 * The response is the pass's own counters rather than `{ ok: true }`, because
 * a short pass and a quiet one look identical from outside and only one of
 * them is fine. `limitedBy` says which ceiling bit; `refused` says the pass
 * declined to run at all, which is what happens when there is no secret to
 * sign unsubscribe links with.
 */
export const maxDuration = 120;

export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const started = Date.now();
  const result = await runLifecyclePass();

  return NextResponse.json({
    ok: !result.refused,
    ...result,
    ms: Date.now() - started,
  });
}
