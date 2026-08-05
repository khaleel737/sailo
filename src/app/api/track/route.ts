import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/redis";
import { cookies, headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { products, shops, visits } from "@/db/schema";
import { classifyVisit, parseUserAgent } from "@/lib/analytics";

const COOKIE = "sailo_sid";
const SIX_MONTHS = 60 * 60 * 24 * 180;

export async function POST(request: Request) {
  /*
   * Public, unauthenticated and it writes a row — the shape of endpoint that
   * gets hammered. Keyed on the caller's address; fails open, because a
   * limiter that blocks real buyers when its own backend is down has cost
   * more than the traffic it stopped.
   */
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
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
  if (!shopId) return NextResponse.json({ ok: false }, { status: 400 });

  const db = getDb();
  const shop = await db.query.shops.findFirst({
    where: and(eq(shops.id, shopId), eq(shops.isPublished, true)),
    columns: { id: true },
  });
  if (!shop) return NextResponse.json({ ok: false }, { status: 404 });

  // Only record a product view if that product really belongs to this shop.
  let validProductId: string | null = null;
  if (productId) {
    const p = await db.query.products.findFirst({
      where: and(eq(products.id, productId), eq(products.shopId, shop.id)),
      columns: { id: true },
    });
    validProductId = p?.id ?? null;
  }

  const jar = await cookies();
  let sid = jar.get(COOKIE)?.value;
  if (!sid) {
    sid = crypto.randomUUID();
    jar.set(COOKIE, sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SIX_MONTHS,
      path: "/",
    });
  }

  const h = await headers();

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

  await db.insert(visits).values({
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
  });

  return NextResponse.json({ ok: true });
}
