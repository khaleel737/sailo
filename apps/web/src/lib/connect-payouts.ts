import "server-only";
import type Stripe from "stripe";
import type { Shop } from "@sailo/db/schema";
import { actingAs } from "@/lib/connect";
import { groupBalances, type PayoutOverview } from "@/lib/payout-summary";
import { withRedis } from "@/lib/redis";
import { stripe } from "@/lib/stripe";

/**
 * The seller's money, as Stripe sees it: balance, recent payouts, and whether
 * Stripe is still owed information.
 *
 * Three API reads per shop, so the result is cached for five minutes — this
 * page gets F5'd on payday, and the numbers move on Stripe's schedule, not
 * ours. Redis is the accelerator, never the source of truth (the rule at the
 * top of `lib/redis.ts`): cold Redis means live reads, not a blank card.
 *
 * Returns null when Stripe itself can't be reached — the card degrades to
 * "try again" and the rest of the payments page stays editable.
 */

const CACHE_SECONDS = 300;

export const payoutCacheKey = (shopId: string) => `sailo:payouts:${shopId}`;

export async function getPayoutOverview(
  shop: Shop,
): Promise<PayoutOverview | null> {
  if (!shop.stripeAccountId) return null;

  const key = payoutCacheKey(shop.id);

  const cached = await withRedis(
    (redis) => redis.get(key),
    null as string | null,
  );
  if (cached) {
    try {
      return JSON.parse(cached) as PayoutOverview;
    } catch {
      // A malformed cache entry is a cache miss, not a broken page.
    }
  }

  let overview: PayoutOverview;
  try {
    const accountId = shop.stripeAccountId;
    const asSeller = actingAs(accountId);

    const [balance, payouts, account] = await Promise.all([
      stripe().balance.retrieve({}, asSeller),
      stripe().payouts.list({ limit: 10 }, asSeller),
      stripe().accounts.retrieve(accountId),
    ]);

    overview = {
      balances: groupBalances(balance.available, balance.pending),
      payouts: payouts.data.map((p: Stripe.Payout) => ({
        id: p.id,
        amountCents: p.amount,
        currency: p.currency.toUpperCase(),
        status: p.status,
        created: p.created,
        arrivalDate: p.arrival_date ?? null,
      })),
      payoutsEnabled: Boolean(account.payouts_enabled),
      requirementsDue: account.requirements?.currently_due ?? [],
    };
  } catch (error) {
    console.error("[sailo] could not read payout state from Stripe:", error);
    return null;
  }

  await withRedis(async (redis) => {
    await redis.set(key, JSON.stringify(overview), { EX: CACHE_SECONDS });
    return undefined;
  }, undefined);

  return overview;
}
