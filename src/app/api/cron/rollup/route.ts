import { NextResponse } from "next/server";
import { rollUpVisits } from "@/lib/analytics-rollup";

/**
 * Nightly analytics fold. Scheduled from vercel.json.
 *
 * Vercel signs cron invocations with CRON_SECRET; without that check this is
 * an open endpoint that anyone could hammer into doing the whole fleet's
 * aggregation on demand.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const started = Date.now();
  const result = await rollUpVisits();

  return NextResponse.json({
    ...result,
    ms: Date.now() - started,
  });
}

// Folding a fleet's worth of days is not a two-second job.
export const maxDuration = 300;
