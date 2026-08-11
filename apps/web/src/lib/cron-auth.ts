import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The only credential a scheduled route has.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on every scheduled
 * request once that variable is set, so there is nothing else to check — and
 * checking anything else was actively harmful: an earlier version of the sweep
 * also accepted a `user-agent` containing "vercel-cron", which anyone can
 * send. `curl -H "user-agent: vercel-cron"` was enough to cancel a shop's
 * pending orders. A header the caller controls is not a credential.
 *
 * Written once because the three cron routes had written it three times and
 * two of them had it wrong. `sweep` refused the request when `CRON_SECRET` was
 * missing; `rollup` and `sitemap` wrapped the whole check in `if (secret)`, so
 * an unset variable made them fully public — `rollup` then runs the fleet's
 * analytics aggregation, with `maxDuration = 300`, for anyone who asks. An
 * absent secret is a misconfiguration, and the safe reading of a
 * misconfiguration on an endpoint that writes is "no", not "yes to everyone".
 */
export function cronAuthFailure(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  }

  const presented = request.headers.get("authorization") ?? "";
  if (!timingSafeEqualString(presented, `Bearer ${secret}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

/** Compares without revealing where two strings first differ. */
function timingSafeEqualString(a: string, b: string) {
  // `timingSafeEqual` throws on a length mismatch, which would itself be a
  // signal, so hash both to a fixed width first.
  const ha = createHash("sha256").update(Buffer.from(a)).digest();
  const hb = createHash("sha256").update(Buffer.from(b)).digest();
  return timingSafeEqual(ha, hb);
}
