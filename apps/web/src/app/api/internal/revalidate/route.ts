import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { handleTag, shopTag } from "@/lib/cache";

/**
 * Drop a shop out of this app's storefront cache, on apps/hq's say-so.
 *
 * ─── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * Staff suspending a shop has to take its storefront down *now*. While the
 * staff panel lived inside this app that was `updateShopNow()` — a direct call
 * into the same process's cache. apps/hq is its own deployment now, and its
 * `revalidateTag` reaches its own cache, which is empty and serves nobody. The
 * suspension would have been written to the database, shown as done in the
 * panel, and the storefront would have gone on serving from cache until
 * something else happened to invalidate it.
 *
 * That is the single worst thing this migration could have broken quietly, so
 * it is a seam rather than an accident.
 *
 * ─── WHY `{ expire: 0 }` AND NOT `"max"` ───────────────────────────────────
 * `updateTag` is the natural fit and cannot be used: it is Server-Actions-only
 * by design, and this is a Route Handler. `revalidateTag(tag, "max")` is
 * stale-while-revalidate — it would let one more request through on the old
 * copy, and the note this replaces was explicit that "enforcement that lets one
 * more request through isn't enforcement".
 *
 * `{ expire: 0 }` is the documented escape hatch for exactly this shape:
 * "for webhooks or third-party services that need immediate expiration ...
 * necessary when external systems call your Route Handlers and require data to
 * expire immediately". apps/hq is now such an external system.
 * ───────────────────────────────────────────────────────────────────────────
 */

/**
 * Constant-time, and length-tolerant.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak the
 * secret's length through the difference between a 500 and a 401 — so the
 * lengths are compared first and the result folded in, rather than returned
 * early.
 */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still do the work, against a self-comparison, so the timing does not
    // depend on whether the length was right.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const expected = env.SAILO_INTERNAL_SECRET;
  /*
   * Unset means refuse, never means allow. An environment that forgot to
   * configure this must not become one where anyone can flush the cache of
   * every storefront on the platform — that is a cheap denial of service
   * against the whole product.
   */
  if (!expected) {
    console.error("[sailo] internal revalidate called with no SAILO_INTERNAL_SECRET set");
    return Response.json({ ok: false }, { status: 503 });
  }

  const given = request.headers.get("x-sailo-internal") ?? "";
  if (!secretMatches(given, expected)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  let body: { shopId?: unknown; handle?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const shopId = typeof body.shopId === "string" ? body.shopId : null;
  if (!shopId) {
    return Response.json({ ok: false, error: "shopId required" }, { status: 400 });
  }
  const handle = typeof body.handle === "string" ? body.handle : null;

  revalidateTag(shopTag(shopId), { expire: 0 });
  if (handle) revalidateTag(handleTag(handle), { expire: 0 });

  return Response.json({ ok: true });
}
