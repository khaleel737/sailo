import { NextResponse } from "next/server";
import { after } from "next/server";
import { rateLimit } from "@sailo/rate-limit";
import { ipFromHeaders } from "@sailo/rate-limit/client-ip";
import { publishShopEvent } from "@sailo/events";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { liveShop } from "@/lib/shop-visibility";
import { CLICK_KINDS, clicks, products, shops, visits, type ClickKind } from "@sailo/db/schema";
import { classifyVisit, outboundHost, parseUserAgent } from "@sailo/analytics/traffic";
import { ensurePartition } from "@sailo/analytics/partitions";
import { visitorId } from "@sailo/analytics/visitor";
import { isUuid } from "@sailo/core/uuid";


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
    /** Absent on the original visit beacon; "click" on the outbound variant. */
    type?: string;
    shopId?: string;
    productId?: string;
    referrer?: string;
    url?: string;
    kind?: string;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // The outbound-click variant of the beacon, discriminated on `type` so the
  // visit shape stays exactly what every cached storefront page already sends.
  if (payload.type === "click") return recordClick(request, payload, ip);

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
    // A shop that isn't reachable can't have been visited, so a beacon naming
    // one is either stale or forged. Either way it shouldn't add to anyone's
    // analytics.
    where: liveShop(eq(shops.id, shopId)),
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
  let recorded = true;
  try {
    await db.insert(visits).values(visit);
  } catch (error) {
    try {
      await ensurePartition(new Date());
      await db.insert(visits).values(visit);
    } catch {
      recorded = false;
      console.warn("track: could not record a visit", error);
    }
  }

  /*
   * Tell any open dashboard its numbers moved — after the response, because
   * this is the hottest endpoint in the app and the beacon's latency budget
   * belongs to the storefront. The bus gates this to one announcement per
   * shop per window, so a traffic spike reads as a dashboard that ticks,
   * not a dashboard under load. Only when a row was really written: a
   * count that didn't change is not worth a repaint.
   */
  if (recorded) after(() => publishShopEvent(shop.id, "visit"));

  return NextResponse.json({ ok: true });
}

/**
 * The outbound-click variant: a visitor leaving through a link the seller put
 * on their page.
 *
 * Every outcome past the rate limit is a bodyless 204, row or no row. The
 * visit path answers 400/404 because a storefront integration needs to hear
 * that its shopId is wrong — but this branch's failure modes are hostile or
 * garbage bodies, and answering them differently makes the endpoint an oracle
 * for probing which URLs we count. A silent drop costs one click.
 *
 * The host is derived here from the posted URL — `outboundHost` — never taken
 * from the client as a string, and only the host is stored: a destination URL
 * can carry the buyer's own words in its query (a prefilled WhatsApp message
 * is the whole order).
 */
async function recordClick(
  request: Request,
  payload: { shopId?: string; url?: string; kind?: string },
  ip: string | null,
) {
  const done = new Response(null, { status: 204 });

  if (!isUuid(payload.shopId)) return done;

  const db = getDb();
  const shop = await db.query.shops.findFirst({
    // The same bar a visit has to clear.
    where: liveShop(eq(shops.id, payload.shopId)),
    columns: { id: true },
  });
  if (!shop) return done;

  const h = await headers();
  const targetHost = outboundHost(payload.url, h.get("host"));
  if (!targetHost) return done;

  // An unknown kind still counts as a click — it lands in "other" rather than
  // giving a probing client a different answer for a made-up value.
  const kind: ClickKind = (CLICK_KINDS as readonly string[]).includes(
    payload.kind ?? "",
  )
    ? (payload.kind as ClickKind)
    : "other";

  const sid = visitorId({
    ip,
    userAgent: h.get("user-agent"),
    shopId: shop.id,
  });

  try {
    await db.insert(clicks).values({
      shopId: shop.id,
      targetHost,
      kind,
      sessionId: sid,
    });
  } catch (error) {
    // A lost click is a rounding error; a 500 in a buyer's console is not.
    console.warn("track: could not record a click", error);
    return done;
  }

  // The dashboard's destinations panel counts these — same gated hint, same
  // reasoning as the visit path above.
  after(() => publishShopEvent(shop.id, "visit"));

  return done;
}
