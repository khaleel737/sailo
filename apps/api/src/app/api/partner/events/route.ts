import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { affiliates } from "@sailo/db/schema";
import { subscribeAffiliateEvents } from "@sailo/events";
import { eventStreamResponse } from "@sailo/events/stream";
import { rateLimit } from "@sailo/rate-limit";
import { ipFromHeaders } from "@sailo/rate-limit/client-ip";

/**
 * The partner portal's ear, mounted on the API origin as well as on apps/web.
 *
 * ─── WHY THIS IS A DUAL MOUNT AND NOT A MOVE ───────────────────────────────
 * apps/web keeps its copy at the same path. That is deliberate: the browser
 * page that opens this stream — `apps/web/src/app/partner/[token]/page.tsx`,
 * via `<LiveRefresh>` — asks for a *relative* URL, so it keeps talking to the
 * web origin and nothing about the portal changes. This copy exists for
 * callers that address the API origin directly.
 *
 * Relocating outright would have been safe here, and it is worth writing down
 * why, because the same reasoning does not hold for the neighbouring streams.
 * This route reads no cookie. It resolves `?token=` against
 * `affiliates.portalToken` and that is the whole of its authentication — the
 * portal has no session, exactly as `/partner/[token]` itself has none. So
 * serving it from a second origin cannot force `SameSite=None` on a session
 * cookie, because there is no session cookie on this path to loosen.
 *
 * `/api/admin/events` and `/api/hq/events` are the opposite case: they
 * authenticate from the better-auth session cookie. Do not copy this file for
 * them. Moving those cross-origin would mean widening a real session cookie to
 * `SameSite=None`, which trades a CSRF defence for a routing convenience.
 *
 * One thing this copy does NOT have: CORS headers. `EventSource` is a
 * credential-less GET here, so a cross-origin consumer needs
 * `Access-Control-Allow-Origin` — and nothing needs it yet, so nothing grants
 * it. Add it when a real cross-origin caller appears, not before.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * EventSource cannot send headers, which is why the token rides the query
 * string; that adds no exposure a portal link doesn't already have, since
 * the same token is the path of every page view and emailed link.
 *
 * Rate-limited per address because unlike /admin and /hq this door is
 * public, and a 404 per guess must not become a free token oracle at
 * network speed. Same fail-open shape as every limiter here.
 */

export const maxDuration = 300;

export async function GET(request: Request) {
  const verdict = await rateLimit(
    `partner-events:${ipFromHeaders(request.headers)}`,
    30,
    60,
  );
  if (!verdict.allowed) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const token = new URL(request.url).searchParams.get("token") ?? "";
  // Shaped like ours before it touches the database, mirroring the track
  // route's discipline about untrusted identifiers.
  if (token.length < 16 || token.length > 128) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const affiliate = await getDb().query.affiliates.findFirst({
    where: eq(affiliates.portalToken, token),
    columns: { id: true },
  });
  if (!affiliate) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  return eventStreamResponse(
    (onEvent, onLost) => subscribeAffiliateEvents(affiliate.id, onEvent, onLost),
    request.signal,
  );
}
