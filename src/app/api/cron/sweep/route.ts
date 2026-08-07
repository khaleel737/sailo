import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/cron-auth";
import { releaseAbandonedCheckouts } from "@/lib/inventory";

/**
 * Housekeeping that must happen whether or not a webhook arrived.
 *
 * Scheduled hourly in `vercel.json`. Everything it does is idempotent, so
 * running it twice — or by hand while debugging — is harmless.
 */
export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const abandoned = await releaseAbandonedCheckouts();

  return NextResponse.json({
    ok: true,
    abandonedCheckoutsReleased: abandoned.swept,
  });
}
