import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  coupons,
  deliveryMethods,
  eventTiers,
  productVariants,
  products,
} from "@sailo/db/schema";
import { shopTag } from "@/lib/cache";

/**
 * Which of a shop's ticked currencies it can actually quote.
 *
 * The failure this exists to prevent is not subtle and is not cosmetic: a
 * catalogue where product A has a euro price and product B does not, and B is
 * rendered at its dollar integer with a `€` in front of it. That is a wrong
 * price on a page somebody can buy from.
 *
 * So the unit of offering is the **shop**, not the product. A currency is live
 * when every published product, every variant that overrides a price, every
 * enabled delivery rate and every active coupon that names an amount carries a
 * price in it. Anything short of that and the currency is not offered at all,
 * and the settings card tells the seller exactly what is missing — rule 8, no
 * silent caps, pointed at the seller rather than at the buyer.
 *
 * See `docs/specs/53-regional-pricing.md`.
 */

/**
 * Four `NOT EXISTS` per currency, asked as one statement.
 *
 * Written as a single query over `unnest` rather than a query per currency: a
 * shop offering four currencies would otherwise issue sixteen round trips on
 * the storefront's path, and with a serverless driver every one of them is an
 * HTTP request.
 *
 * `jsonb_exists` rather than the `?` operator, which is a placeholder in
 * several drivers and reads as one to every human being.
 */
async function readLiveCurrencies(
  shopId: string,
  enabled: readonly string[],
  shopCurrency: string,
): Promise<string[]> {
  const db = getDb();

  /*
   * The shop's own currency is never in this list — it is quoted by every
   * price column already, and a duplicate entry would be a second place for
   * the same price to be edited. Filtered here as well as at the write,
   * because the column is a stored array and this is a read.
   */
  const wanted = [
    ...new Set(
      enabled
        .map((c) => c.toUpperCase())
        .filter((c) => c && c !== shopCurrency.toUpperCase()),
    ),
  ];
  if (wanted.length === 0) return [];

  /*
   * `unnest(array[$1, $2])` rather than binding the whole array as one
   * parameter. The Neon HTTP driver serialises a JS array of strings as a
   * comma-joined scalar, so `unnest($1::text[])` reaches Postgres as
   * `'EUR'::text[]` and fails with `malformed array literal`. Each code as its
   * own placeholder is both correct and still parameterised — the codes come
   * from a stored column, but so does every other value in this file, and
   * interpolating one of them would be the habit rather than the exception.
   */
  const list = sql.join(
    wanted.map((code) => sql`${code}`),
    sql`, `,
  );

  const rows = await db
    .select({ currency: sql<string>`c` })
    .from(sql`unnest(array[${list}]::text[]) as c`)
    .where(
      and(
        sql`not exists (
          select 1 from ${products} p
          where p.shop_id = ${shopId}
            and p.is_published
            and not jsonb_exists(p.currency_prices, c)
        )`,
        /*
         * Only variants that *override* the product's price. One that inherits
         * inherits in every currency alike, so demanding an entry for it would
         * take a whole catalogue out of euros for the sake of rows that carry
         * no price at all.
         */
        sql`not exists (
          select 1 from ${productVariants} v
          join ${products} p on p.id = v.product_id
          where p.shop_id = ${shopId}
            and p.is_published
            and v.price_cents is not null
            and not jsonb_exists(v.currency_prices, c)
        )`,
        /*
         * A published event with price bands holds every other currency back —
         * spec 50.
         *
         * `event_tiers` has a `price_cents` and no `currency_prices`: a band is
         * one number, in the shop's own currency, and there is nowhere to put a
         * euro one. `resolveLines` therefore refuses a tiered line whenever the
         * order is priced in anything else — refuses rather than falls back,
         * because the product's euro price is a price for a *different* ticket
         * and charging it would sell VIP at the general rate.
         *
         * Without this clause that refusal is invisible: euros go live off a
         * fully-priced catalogue, and every ticket sale in euros fails with
         * "isn't available right now" while the seller sees nothing wrong. One
         * currency not going live is a state they can see and ask about; a
         * checkout that quietly stops taking money is not.
         *
         * Blunter than the variant rule above, and deliberately so — there is
         * no "only bands that override" case to carve out, because a band that
         * inherits nothing is still a price. The real fix is `currency_prices`
         * on `event_tiers`, which is a migration and an editor; until then this
         * is the honest shape.
         */
        sql`not exists (
          select 1 from ${eventTiers} t
          join ${products} p on p.id = t.product_id
          where p.shop_id = ${shopId}
            and p.is_published
        )`,
        sql`not exists (
          select 1 from ${deliveryMethods} d
          where d.shop_id = ${shopId}
            and d.is_enabled
            and not jsonb_exists(d.currency_prices, c)
        )`,
        /*
         * A percentage coupon is currency-free — 10% off is 10% off — so it
         * holds nothing back. Only a fixed amount, or a minimum subtotal, is a
         * number in a currency.
         */
        sql`not exists (
          select 1 from ${coupons} k
          where k.shop_id = ${shopId}
            and k.is_active
            and (k.discount_type = 'fixed' or k.min_subtotal_cents > 0)
            and not jsonb_exists(k.currency_prices, c)
        )`,
      ),
    );

  return rows.map((r) => r.currency);
}

/**
 * The same answer, cached under the shop's tag.
 *
 * Every write that changes what a storefront shows already calls
 * `revalidateShop`, and a price is exactly such a write — so this needs no
 * invalidation of its own. `cacheLife("max")` for the same reason the
 * catalogue uses it: a seller who finishes pricing euros should see the
 * currency go live on the next render, not in five minutes.
 */
export async function liveCurrencies(
  shopId: string,
  enabled: readonly string[],
  shopCurrency: string,
): Promise<string[]> {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return readLiveCurrencies(shopId, enabled, shopCurrency);
}

/**
 * What is stopping a currency going live, for the seller's settings card.
 *
 * Counts rather than lists, and uncached: this is read on an admin page by one
 * person who has just edited a price, and a cached answer would be the one
 * thing on that screen that disagrees with what they just did.
 *
 * Named counts rather than a single "incomplete" boolean, because "add a price
 * to 3 products and 1 delivery rate" is an instruction and "not ready" is not.
 */
export type CurrencyGaps = {
  currency: string;
  products: number;
  variants: number;
  delivery: number;
  coupons: number;
  /**
   * Price bands on a published event — spec 50.
   *
   * A count of bands rather than of unpriced ones, because none of them can be
   * priced in another currency at all: `event_tiers` has a `price_cents` and no
   * `currency_prices`. So this is not "add a price to three of these", it is
   * "this shop sells tickets in bands and cannot quote them in euros" — the one
   * gap on this card the seller cannot close by typing a number, and therefore
   * the one they most need named rather than left to work out.
   */
  tiers: number;
};

export async function currencyGaps(
  shopId: string,
  enabled: readonly string[],
  shopCurrency: string,
): Promise<CurrencyGaps[]> {
  const db = getDb();
  const shop = shopCurrency.toUpperCase();
  const wanted = [
    ...new Set(enabled.map((c) => c.toUpperCase()).filter((c) => c && c !== shop)),
  ];
  if (wanted.length === 0) return [];

  const missing = (column: string, code: string) =>
    sql<string>`count(*) filter (where not jsonb_exists(${sql.raw(column)}, ${code}))`;

  const out: CurrencyGaps[] = [];
  for (const code of wanted) {
    const [[productRow], [variantRow], [deliveryRow], [couponRow], [tierRow]] =
      await Promise.all([
      db
        .select({ n: missing("products.currency_prices", code) })
        .from(products)
        .where(and(eq(products.shopId, shopId), eq(products.isPublished, true))),
      db
        .select({ n: missing("product_variants.currency_prices", code) })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(
          and(
            eq(products.shopId, shopId),
            eq(products.isPublished, true),
            sql`${productVariants.priceCents} is not null`,
          ),
        ),
      db
        .select({ n: missing("delivery_methods.currency_prices", code) })
        .from(deliveryMethods)
        .where(
          and(eq(deliveryMethods.shopId, shopId), eq(deliveryMethods.isEnabled, true)),
        ),
      db
        .select({ n: missing("coupons.currency_prices", code) })
        .from(coupons)
        .where(
          and(
            eq(coupons.shopId, shopId),
            eq(coupons.isActive, true),
            sql`(${coupons.discountType} = 'fixed' or ${coupons.minSubtotalCents} > 0)`,
          ),
        ),
      // Every band on a published event, because every one of them blocks.
      db
        .select({ n: sql<string>`count(*)` })
        .from(eventTiers)
        .innerJoin(products, eq(products.id, eventTiers.productId))
        .where(and(eq(products.shopId, shopId), eq(products.isPublished, true))),
    ]);

    out.push({
      currency: code,
      products: Number(productRow?.n ?? 0),
      variants: Number(variantRow?.n ?? 0),
      delivery: Number(deliveryRow?.n ?? 0),
      coupons: Number(couponRow?.n ?? 0),
      tiers: Number(tierRow?.n ?? 0),
    });
  }

  return out;
}
