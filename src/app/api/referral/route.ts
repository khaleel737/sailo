import { NextResponse } from "next/server";
import { recordAffiliateClick } from "@/lib/actions/affiliates";

export async function POST(request: Request) {
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
