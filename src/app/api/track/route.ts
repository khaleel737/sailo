import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { products, shops, visits } from "@/db/schema";

const COOKIE = "sailo_sid";
const SIX_MONTHS = 60 * 60 * 24 * 180;

export async function POST(request: Request) {
  let payload: { shopId?: string; productId?: string };
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
  const referrer = h.get("referer");

  await db.insert(visits).values({
    shopId: shop.id,
    productId: validProductId,
    sessionId: sid,
    referrer: referrer ? referrer.slice(0, 500) : null,
    country: h.get("x-vercel-ip-country"),
  });

  return NextResponse.json({ ok: true });
}
