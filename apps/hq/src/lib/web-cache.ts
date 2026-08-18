import "server-only";
import { env } from "@/env";

/**
 * Reaching into apps/web's storefront cache.
 *
 * This is the one thing the split took away that had to be given back. A staff
 * suspension changes what the *public* storefront renders, and that storefront
 * is cached in another deployment — so `revalidateTag` here, which used to be
 * the whole mechanism, now invalidates a cache nobody reads.
 *
 * See `apps/web/src/app/api/internal/revalidate/route.ts` for the other end,
 * including why it forces immediate expiry rather than stale-while-revalidate.
 *
 * FAILURE IS LOUD BUT NOT FATAL, ON PURPOSE
 * The database write has already happened by the time this is called — the shop
 * *is* suspended, and every uncached read already says so. What a failure here
 * costs is that the cached copy lingers, which is bad and is why it is logged
 * at error level with the shop named. What throwing would cost is the staff
 * member seeing the action fail and clicking it again, against a database that
 * already applied it. The write is the source of truth; this is the cache
 * catching up.
 */
export async function revalidateShopOnWeb(shop: {
  id: string;
  handle?: string | null;
}): Promise<{ ok: boolean }> {
  const secret = env.SAILO_INTERNAL_SECRET;
  if (!secret) {
    console.error(
      `[sailo] cannot revalidate shop ${shop.id} on web: SAILO_INTERNAL_SECRET unset`,
    );
    return { ok: false };
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const response = await fetch(`${base}/api/internal/revalidate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sailo-internal": secret,
      },
      body: JSON.stringify({ shopId: shop.id, handle: shop.handle ?? null }),
      /*
       * Never cached, and never held open. This runs inside a Server Action a
       * person is waiting on, so a slow or wedged peer must not be able to hang
       * the click — two seconds is far more than a same-region call needs.
       */
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) {
      console.error(
        `[sailo] web refused revalidation for shop ${shop.id}: ${response.status}`,
      );
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    console.error(`[sailo] revalidation of shop ${shop.id} on web failed`, error);
    return { ok: false };
  }
}
