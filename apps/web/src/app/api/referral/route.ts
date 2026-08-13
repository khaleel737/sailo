import { NextResponse } from "next/server";
import { isUuid } from "@/lib/utils";
import { rateLimit } from "@sailo/rate-limit";
import { ipFromHeaders } from "@sailo/rate-limit/client-ip";
import { recordAffiliateClick } from "@/lib/actions/affiliates";

export async function POST(request: Request) {
  /*
   * Public, unauthenticated and it writes a row — the shape of endpoint that
   * gets hammered. Keyed on the caller's address; fails open, because a
   * limiter that blocks real buyers when its own backend is down has cost
   * more than the traffic it stopped.
   */
  const ip = ipFromHeaders(request.headers);
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

  /*
   * `isUuid`, not merely present. `recordAffiliateClick` compares this against
   * a `uuid` column, and Postgres raises on a value it cannot parse rather
   * than returning nothing — so `{"shopId":"x"}` was a 500 from a public
   * unauthenticated endpoint.
   */
  if (!isUuid(payload.shopId) || !payload.code) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Silently ignores unknown or inactive codes.
  await recordAffiliateClick(payload.shopId, payload.code);
  return NextResponse.json({ ok: true });
}
