import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { affiliates } from "@sailo/db/schema";
import { subscribeAffiliateEvents } from "@sailo/events";
import { eventStreamResponse } from "@sailo/events/stream";
import { rateLimit } from "@sailo/rate-limit";
import { ipFromHeaders } from "@sailo/rate-limit/client-ip";

/**
 * The partner portal's ear. The portal has no session — the unguessable
 * token in the URL is the credential, exactly as it is for the page itself
 * (`/partner/[token]`) — so the stream authenticates the same way: resolve
 * the token to an affiliate, or say nothing.
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
