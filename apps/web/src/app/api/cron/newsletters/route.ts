import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import { runNewsletterQueue } from "@sailo/marketing/newsletter/server";

/**
 * One tick of Sailo's own newsletter queue.
 *
 * Every five minutes, matching the shop-side broadcast queue, and for the same
 * reason: a campaign is drained one batch at a time rather than sent in one
 * call, so the tick rate is what decides how long a send takes. Five minutes
 * against a hundred-message batch is a comfortable few thousand an hour, which
 * is well inside any sending reputation's tolerance for a new stream — and
 * slow enough that a typo spotted in the second paragraph can still be caught
 * before most of the list has seen it.
 *
 * Safe to run twice, and that is a property of the claim rather than of the
 * schedule: each delivery row is claimed by an UPDATE with `FOR UPDATE SKIP
 * LOCKED`, so an overlapping tick claims nothing the first one holds.
 *
 * The response is the pass's own counters rather than `{ ok: true }`, because
 * a short pass and a quiet one look identical from outside and only one of
 * them is fine. `held` says a ceiling bit rather than the queue being empty.
 */
export const maxDuration = 120;

export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const started = Date.now();
  const result = await runNewsletterQueue();

  return NextResponse.json({ ok: true, ...result, ms: Date.now() - started });
}
