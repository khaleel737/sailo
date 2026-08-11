"use server";

import { revalidatePath } from "next/cache";
import { requireShop } from "@/lib/session";
import { payoutCacheKey } from "@/lib/connect-payouts";
import { rateLimit, withRedis } from "@/lib/redis";

/**
 * Drops the cached payout overview so the next render reads Stripe live.
 *
 * Rate limited per shop, not per address: 10 a minute is plenty of pressing
 * Refresh, and the ceiling exists because behind this button are three Stripe
 * API reads on a page that gets F5'd on payday. Hitting the ceiling isn't an
 * error the seller needs to hear about — the page re-renders from the cache,
 * which is at most five minutes old.
 */
export async function refreshPayouts() {
  const { shop } = await requireShop();
  if (!shop.stripeAccountId) return;

  const verdict = await rateLimit(`payouts-refresh:${shop.id}`, 10, 60);
  if (verdict.allowed) {
    await withRedis(async (redis) => {
      await redis.del(payoutCacheKey(shop.id));
      return undefined;
    }, undefined);
  }

  revalidatePath("/admin/payments");
}
