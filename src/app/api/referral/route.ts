import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/redis";
import { recordAffiliateClick } from "@/lib/actions/affiliates";

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
  const verdict = await rateLimit(`ref:${ip}`, 60, 60);
  if (!verdict.allowed) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  let payload: { shopId?: string; code?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!payload.shopId || !payload.code) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Silently ignores unknown or inactive codes.
  await recordAffiliateClick(payload.shopId, payload.code);
  return NextResponse.json({ ok: true });
}
