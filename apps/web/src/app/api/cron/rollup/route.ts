import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import { rollUpVisits } from "@sailo/analytics/rollup";
import { rollUpPlatformUsage } from "@sailo/commerce/disputes";

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

  /*
   * Spec 46 — what each paying seller actually did with their subscription,
   * folded into one row per shop per day.
   *
   * Here rather than in its own cron because it reads the same window the visit
   * fold has just finished, and because the sources it aggregates are the ones
   * that get pruned: `visit_daily` is swept, `account_events` is kept 400 days,
   * orders are permanent. An evidence claim must not depend on a table that
   * empties itself.
   *
   * A day this run misses is a **gap**, not a zero — `rolled_up_at` is what
   * makes the two distinguishable, and the evidence prints gaps as gaps. A false
   * zero would argue Sailo's own case against it in front of an issuer.
   */
  const usage = await rollUpPlatformUsage();

  return NextResponse.json({
    ...result,
    platformUsageShops: usage.shops,
    platformUsageDays: usage.days,
    ms: Date.now() - started,
  });
}

// Folding a fleet's worth of days is not a two-second job.
export const maxDuration = 300;
