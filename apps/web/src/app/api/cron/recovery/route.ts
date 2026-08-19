import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import { runRecoveryPass } from "@sailo/workflows/recovery";

/**
 * One pass over abandoned checkouts — spec 32.
 *
 * Hourly, and the three-hour threshold is in the query rather than in the
 * schedule: a session becomes due three hours after it was *opened*, so the
 * cadence only decides how soon after that the mail goes, never whether it
 * goes at all.
 *
 * Safe to run twice. Each session is claimed by a conditional UPDATE with
 * `recovery_sent_at is null` in the WHERE, which is the whole of the "one
 * email, ever" guarantee — two overlapping passes claim nothing twice.
 *
 * Deliberately separate from `/api/cron/sweep`, which cancels unpaid orders at
 * 24 hours and reclaims stock and slots. This runs at 3 hours and extends no
 * hold: a recovered buyer arriving at hour 20 may find the last unit gone, and
 * the checkout says so honestly. Holding stock for a maybe is worse.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const result = await runRecoveryPass();

  return NextResponse.json({ ok: true, ...result });
}
