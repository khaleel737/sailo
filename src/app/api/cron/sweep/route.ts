import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { releaseAbandonedCheckouts } from "@/lib/inventory";

/**
 * Housekeeping that must happen whether or not a webhook arrived.
 *
 * Scheduled hourly in `vercel.json`. Everything it does is idempotent, so
 * running it twice — or by hand while debugging — is harmless.
 */
export async function GET() {
  /*
   * The bearer secret is the only credential.
   *
   * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on every scheduled
   * request once that variable is set, so there is nothing else to check —
   * and checking anything else was actively harmful: an earlier version also
   * accepted a `user-agent` containing "vercel-cron", which anyone can send.
   * `curl -H "user-agent: vercel-cron"` was enough to cancel a shop's pending
   * orders. A header the caller controls is not a credential.
   */
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  }

  const h = await headers();
  const presented = h.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  // Constant-time: a length-independent comparison leaks the secret one
  // character at a time to anyone willing to measure.
  if (!timingSafeEqualString(presented, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const abandoned = await releaseAbandonedCheckouts();

  return NextResponse.json({
    ok: true,
    abandonedCheckoutsReleased: abandoned.swept,
  });
}

/** Compares without revealing where two strings first differ. */
function timingSafeEqualString(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // `timingSafeEqual` throws on a length mismatch, which would itself be a
  // signal, so hash both to a fixed width first.
  const ha = createHash("sha256").update(left).digest();
  const hb = createHash("sha256").update(right).digest();
  return timingSafeEqual(ha, hb);
}
