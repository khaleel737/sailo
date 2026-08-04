import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { releaseAbandonedCheckouts } from "@/lib/inventory";

/**
 * Housekeeping that must happen whether or not a webhook arrived.
 *
 * Scheduled hourly in `vercel.json`. Everything it does is idempotent, so
 * running it twice — or by hand while debugging — is harmless.
 */
export async function GET() {
  // Vercel signs its cron requests; anything else needs the shared secret.
  // Without this, a stranger could sweep a shop's pending orders on demand.
  const h = await headers();
  const isVercelCron = h.get("user-agent")?.includes("vercel-cron") ?? false;
  const secret = process.env.CRON_SECRET;

  if (!isVercelCron) {
    if (!secret) {
      return NextResponse.json(
        { error: "CRON_SECRET is not set" },
        { status: 500 },
      );
    }
    if (h.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const abandoned = await releaseAbandonedCheckouts();

  return NextResponse.json({
    ok: true,
    abandonedCheckoutsReleased: abandoned.swept,
  });
}
