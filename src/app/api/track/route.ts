import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/redis";
import { ipFromHeaders } from "@/lib/client-ip";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { products, shops, visits } from "@/db/schema";
import { classifyVisit, parseUserAgent } from "@/lib/analytics";
import { ensurePartition } from "@/lib/visit-partitions";
import { visitorId } from "@/lib/visitor-id";
import { isUuid } from "@/lib/utils";


export async function POST(request: Request) {
  /*
   * Public, unauthenticated and it writes a row — the shape of endpoint that
   * gets hammered. Keyed on the caller's address; fails open, because a
   * limiter that blocks real buyers when its own backend is down has cost
   * more than the traffic it stopped.
   */
  const ip = ipFromHeaders(request.headers);
  const verdict = await rateLimit(`track:${ip}`, 120, 60);
  if (!verdict.allowed) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  let payload: {
    shopId?: string;
    productId?: string;
    referrer?: string;
    url?: string;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { shopId, productId } = payload;
  /*
   * Shaped like a uuid, not merely present.
   *
   * These go straight into a `uuid` column comparison, and Postgres does not
   * coerce — it raises, which escaped as a 500 from a public unauthenticated
   * beacon. `{"shopId":"x"}` was enough, and every malformed beacon a stale
   * cached page sent would have done it. The row check below is still the real
   * answer to "is this a shop"; this only stops a malformed id reaching it.
   */
  if (!isUuid(shopId)) return NextResponse.json({ ok: false }, { status: 400 });

  const db = getDb();
  const shop = await db.query.shops.findFirst({
    where: and(
      eq(shops.id, shopId),
      eq(shops.isPublished, true),
      // A suspended shop isn't reachable, so a beacon naming one is either
      // stale or forged. Either way it shouldn't add to anyone's analytics.
      isNull(shops.suspendedAt),
    ),
    columns: { id: true },
  });
  if (!shop) return NextResponse.json({ ok: false }, { status: 404 });

  /*
   * Only record a product view if that product really belongs to this shop —
   * and only look at all if the id could name one. A malformed `productId`
   * raised in Postgres the same way a malformed `shopId` did; ignoring it
   * rather than refusing the beacon is right, because the shop's own visit is
   * still worth counting.
   */
  let validProductId: string | null = null;
  if (isUuid(productId)) {
    const p = await db.query.products.findFirst({
      where: and(eq(products.id, productId), eq(products.shopId, shop.id)),
      columns: { id: true },
    });
    validProductId = p?.id ?? null;
  }

  const h = await headers();

  /*
   * Derived per shop per day from data we already hold for the length of this
   * request, and written to nobody's device. See `visitor-id.ts` for why that
   * matters more than the id being random.
   */
  const sid = visitorId({
    ip,
    userAgent: h.get("user-agent"),
    shopId: shop.id,
  });

  // The referrer must come from the browser, not from this request's own
  // `Referer` — that header points at the storefront page that called us, so
  // reading it recorded every visit as a self-referral.
  const origin = classifyVisit({
    referrer: payload.referrer,
    url: payload.url,
    selfHost: h.get("host"),
  });

  // Vercel resolves geography at the edge; these are simply absent locally.
  const geo = (name: string) => {
    const value = h.get(name);
    if (!value) return null;
    // City and region arrive percent-encoded ("S%C3%A3o%20Paulo").
    try {
      return decodeURIComponent(value).slice(0, 120) || null;
    } catch {
      return value.slice(0, 120);
    }
  };

  const ua = parseUserAgent(h.get("user-agent"));

  const visit = {
    shopId: shop.id,
    productId: validProductId,
    sessionId: sid,
    referrer: origin.referrer,
    referrerHost: origin.referrerHost,
    source: origin.source,
    utmSource: origin.utmSource,
    utmMedium: origin.utmMedium,
    utmCampaign: origin.utmCampaign,
    country: h.get("x-vercel-ip-country"),
    region: geo("x-vercel-ip-country-region"),
    city: geo("x-vercel-ip-city"),
    device: ua.device,
    os: ua.os,
    browser: ua.browser,
  };

  /*
   * `visits` is partitioned by month, and a row whose timestamp finds no
   * partition is rejected rather than filed anywhere sensible. The nightly job
   * keeps four months of runway ahead, so this should never happen — but "should
   * never" is doing a lot of work in a beacon that runs on every page view of
   * every shop. So: create the month and try once more.
   *
   * And if it still fails, say ok anyway. This endpoint exists to count a
   * pageview; a lost count is a rounding error, while a 500 is a failed request
   * in a visitor's console on a seller's storefront.
   */
  try {
    await db.insert(visits).values(visit);
  } catch (error) {
    try {
      await ensurePartition(new Date());
      await db.insert(visits).values(visit);
    } catch {
      console.warn("track: could not record a visit", error);
    }
  }

  return NextResponse.json({ ok: true });
}
