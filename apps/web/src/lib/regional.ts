import "server-only";
import { cookies, headers } from "next/headers";
import {
  isRegionalCurrency,
  resolveDisplayCurrency,
} from "@sailo/core/regional";
import { can } from "@sailo/core/plans";
import { liveCurrencies } from "@/lib/queries/regional";
import type { Shop } from "@sailo/db/schema";

/**
 * Which currency one visit is priced in.
 *
 * Server-side, and deliberately outside every cached scope: this reads a
 * header and a cookie, and `lib/cache.ts` is explicit that neither may be read
 * inside `"use cache"`. The answer is then *passed into* the cached catalogue
 * read as an argument, which is what puts it in the cache key — a currency
 * left out of that key serves one visitor's euro page to the next visitor in
 * dollars.
 *
 * See `docs/specs/53-regional-pricing.md`.
 */

/**
 * The switcher's cookie. Named like the locale one and set the same way, for
 * the same reason: written server-side so the very next render already sees
 * it, rather than racing a client-side refresh.
 */
export const CURRENCY_COOKIE = "sailo_ccy";

/** A year, like the locale cookie. A currency preference is not session state. */
export const CURRENCY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type DisplayCurrency = {
  /** What this visit is quoted in. Always a currency the shop can quote. */
  currency: string;
  /** Every currency the visitor may switch to, the shop's own first. */
  options: string[];
};

/**
 * The currency for this request, and what the switcher may offer.
 *
 * `liveCurrencies` is the gate rather than `shop.regionalCurrencies`: a seller
 * ticks a currency before pricing anything in it, and a currency that is half
 * priced must not be offered to anybody. The plan gate is applied here too, so
 * a downgrade stops the currencies being offered without touching a single
 * price the seller typed.
 */
export async function displayCurrency(
  shop: Pick<
    Shop,
    "id" | "currency" | "regionalCurrencies" | "plan" | "subscriptionStatus"
  > & { compPlan?: string | null },
): Promise<DisplayCurrency> {
  const shopCurrency = shop.currency.toUpperCase();

  /*
   * The cheap refusals first, and both of them avoid a query. A shop that has
   * ticked nothing, or one whose plan no longer includes this, has exactly one
   * currency and nothing to look up.
   */
  if (shop.regionalCurrencies.length === 0 || !can(shop, "regionalPricing")) {
    return { currency: shopCurrency, options: [shopCurrency] };
  }

  const [live, store, head] = await Promise.all([
    liveCurrencies(shop.id, shop.regionalCurrencies, shopCurrency),
    cookies(),
    headers(),
  ]);

  const chosen = store.get(CURRENCY_COOKIE)?.value ?? null;

  const currency = resolveDisplayCurrency({
    shopCurrency,
    live,
    chosen: isRegionalCurrency(chosen) ? chosen : null,
    /*
     * The same header `lib/auth.ts` reads for a sign-in's geo. Vercel sets it
     * at the edge from the connecting address, so it is not something a
     * visitor's browser can assert — which is why it is trusted here and
     * `Accept-Language` is not trusted anywhere: a German speaker in London is
     * a GBP buyer, and language is not location.
     */
    country: head.get("x-vercel-ip-country"),
  });

  return { currency, options: [shopCurrency, ...live] };
}
