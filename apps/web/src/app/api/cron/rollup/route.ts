import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import { rollUpVisits } from "@sailo/analytics/rollup";

/**
 * Nightly analytics fold. Scheduled from vercel.json.
 *
 * Vercel signs cron invocations with CRON_SECRET; without that check this is
 * an open endpoint that anyone could hammer into doing the whole fleet's
 * aggregation on demand.
 */
export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const started = Date.now();
  const result = await rollUpVisits();

  return NextResponse.json({
    ...result,
    ms: Date.now() - started,
  });
}

// Folding a fleet's worth of days is not a two-second job.
export const maxDuration = 300;
