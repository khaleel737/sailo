import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { categories, productFiles, productImages, productVariants, products, reviews, type Category, type CurrencyPrices, type Product, type ProductImage, type ProductVariant } from "@sailo/db/schema";
import { shopTag } from "@/lib/cache";
import { minorPerMajor } from "@sailo/core/currency";
import { productAtCurrency, variantAtCurrency } from "@sailo/core/regional";
import { nextOffsetFor, orderByIds } from "./pagination";
import { sellerCatalogue, sellerProduct } from "@sailo/commerce/catalog";
import { hiddenOutsideWindow } from "@sailo/core/pricing-models";

/** Reading the catalogue, for the storefront and for the admin. */

export type ProductCard = Product & {
  images: ProductImage[];
  category: Category | null;
  variants: ProductVariant[];
  avgRating: number | null;
  reviewCount: number;
};

export type ShopFilters = {
  q?: string;
  category?: string;
  kind?: string;
  sort?: string;
  min?: string;
  max?: string;
  inStock?: string;
};

/** The sorts the catalogue offers. Anything else falls back to the default. */
const SORT_KEYS = ["price_asc", "price_desc", "newest", "oldest", "rating"] as const;

/**
 * The only seven keys that reach the cache, with everything else dropped.
 *
 * `getPublicProducts` is `"use cache"` with `cacheLife("max")` — entries never
 * expire on a clock — and it is keyed on its arguments. The storefront page
 * cast raw `searchParams` straight into it, so every key a visitor could
 * invent became part of that key: `?fbclid=…` is unique per click, and sellers
 * here live on Instagram and Facebook links. Every social click was a
 * guaranteed miss, a fresh set of catalogue queries, and one permanent cache
 * entry — the cache defeated by exactly the traffic it was built for, and an
 * unbounded write surface for anyone who wanted one.
 *
 * The values are bounded as well as the keys. `q` is matched with a leading
 * wildcard, so it cannot use an index; left uncapped it is a 1 MB pattern
 * scanned across a whole catalogue, twice, per request.
 */
export function pickFilters(input: Record<string, unknown>): ShopFilters {
  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

  const sort = text(input.sort, 20);

  // Built key by key in a fixed order, so two visitors who chose the same
  // filters in a different order share one entry rather than minting two.
  return {
    q: text(input.q, 80),
    category: text(input.category, 80),
    kind: text(input.kind, 20),
    sort: sort && (SORT_KEYS as readonly string[]).includes(sort) ? sort : undefined,
    min: text(input.min, 20),
    max: text(input.max, 20),
    inStock: input.inStock === "1" ? "1" : undefined,
  };
}

/**
 * What the storefront search matches against: title and description as one
 * string, so a search for "blue mug" finds a product titled "Blue" described
 * as "a mug".
 *
 * This must stay character-for-character identical to the expression indexed
 * by `products_search_trgm_idx` (drizzle/0005_product_search.sql). Postgres
 * matches an expression index by the expression's parse tree, so changing the
 * separator or dropping the coalesce here silently falls back to a full scan
 * of the shop's catalogue — no error, just a query that gets slower as the
 * catalogue grows.
 *
 * Exported only so e2e/scenarios/search.scenario.ts can plan the real
 * expression instead of a copy of it, which is what makes that test able to
 * notice the drift this comment is asking you to avoid.
 */
export const productSearchExpr = sql`(${products.title} || ' ' || coalesce(${products.description}, ''))`;

/** How many cards one batch of the storefront grid holds. */
export const PRODUCT_PAGE_SIZE = 24;

export type ProductPage = {
  items: ProductCard[];
  /** Every match for the filter, not just this batch — what the filter bar counts. */
  total: number;
  /** Offset to ask for next, or null when the catalogue is exhausted. */
  nextOffset: number | null;
};

const EMPTY_PAGE: ProductPage = { items: [], total: 0, nextOffset: null };

/**
 * The public catalog query — search, category, kind, price range and sort all
 * resolve here so the template stays a dumb renderer.
 *
 * Read in three steps rather than one. The catalogue is unbounded on the
 * Business plan, so the batch has to be chosen in SQL before any relation is
 * loaded: fetching every product's images and variants and then slicing in
 * JavaScript would leave the expensive part uncapped, which is the whole
 * problem. Step one picks the page's ids, step two loads relations for those
 * ids only, step three restores the order SQL chose.
 */
/**
 * A product and its variants, re-read in the currency this visit is quoted in.
 *
 * The point of rewriting the rows rather than threading a currency through the
 * renderers: `variantPrice`, `priceRange`, the product card, the buy box and
 * the cart all read `priceCents` off a row, and none of them has to learn what
 * a currency is. One call here, and every reader downstream is unchanged.
 *
 * `productAtCurrency` answers null when there is no price in that currency —
 * it never falls back, because falling back is how a dollar integer ends up
 * with a euro sign in front of it. The WHERE clause above has already excluded
 * those rows, so the `??` here is the assertion rather than the behaviour: if
 * one ever arrives, it keeps the price it actually has.
 */
function inCurrency<
  T extends {
    priceCents: number;
    compareAtCents: number | null;
    currencyPrices: CurrencyPrices;
    variants?: ProductVariant[];
  },
>(product: T, currency: string, shopCurrency: string): T {
  const swapped = productAtCurrency(product, currency, shopCurrency);
  if (!swapped) return product;
  if (!swapped.variants) return swapped;

  return {
    ...swapped,
    variants: swapped.variants.map(
      (variant) => variantAtCurrency(variant, currency, shopCurrency) ?? variant,
    ),
  };
}

async function readPublicProducts(
  shopId: string,
  currency: string,
  shopCurrency: string,
  filters: ShopFilters = {},
  offset = 0,
  limit = PRODUCT_PAGE_SIZE,
): Promise<ProductPage> {
  const db = getDb();
  const where = [eq(products.shopId, shopId), eq(products.isPublished, true)];

  /*
   * Quoting a currency the shop is not its own means every price on this page
   * comes out of `currency_prices`, so a row without an entry has no price to
   * show. Excluded in SQL rather than dropped afterwards, so the count and the
   * batch agree — a filtered list whose total is larger than its contents is
   * how a catalogue silently loses a page.
   *
   * `liveCurrencies` already refuses to offer a currency with a gap in it, so
   * in practice this excludes nothing. It is here because the two answers are
   * cached separately and a seller unpublishing a price opens a window between
   * them, and the safe side of that window is showing one product fewer rather
   * than one price wrong.
   *
   * Variants only when they *override* the product's price; one that inherits
   * inherits in every currency alike.
   */
  const regional = currency.toUpperCase() !== shopCurrency.toUpperCase();
  const code = currency.toUpperCase();
  if (regional) {
    where.push(sql`jsonb_exists(${products.currencyPrices}, ${code})`);
    where.push(sql`not exists (
      select 1 from ${productVariants} v
      where v.product_id = ${products.id}
        and v.price_cents is not null
        and not jsonb_exists(v.currency_prices, ${code})
    )`);
  }

  /*
   * What "price" means to the filter and the sort below.
   *
   * A visitor looking at euros who types 20 in the price filter means €20, and
   * comparing that against `price_cents` would filter a euro page by dollar
   * numbers. The same for `?sort=price_asc`: sorting by the shop's column
   * would order a euro catalogue by its dollar prices, which is nearly right
   * and therefore worse than being obviously wrong.
   */
  const priceExpr: SQL<number> = regional
    ? sql<number>`(${products.currencyPrices} -> ${code} ->> 'price')::int`
    : sql<number>`${products.priceCents}`;

  if (filters.q?.trim()) {
    where.push(sql`${productSearchExpr} ILIKE ${`%${filters.q.trim()}%`}`);
  }

  if (filters.category) {
    const cat = await db.query.categories.findFirst({
      where: and(
        eq(categories.shopId, shopId),
        eq(categories.slug, filters.category),
      ),
    });
    // An unknown category slug should return nothing, not everything.
    if (!cat) return EMPTY_PAGE;
    where.push(eq(products.categoryId, cat.id));
  }

  if (filters.kind) where.push(eq(products.kind, filters.kind));
  if (filters.inStock === "1") where.push(eq(products.inStock, true));

  /*
   * The buyer types a price in major units — "20" means twenty of whatever the
   * shop sells in. A flat hundred read that as 2,000 minor units, which is
   * right for dollars and wrong for the twenty-odd currencies that do not have
   * two decimals: a JPY shop filtering under ¥2,000 was really filtering under
   * ¥20 and saw an empty catalogue.
   */
  const per = minorPerMajor(currency);

  const min = Number(filters.min);
  if (Number.isFinite(min) && filters.min)
    where.push(gte(priceExpr, Math.round(min * per)));

  const max = Number(filters.max);
  if (Number.isFinite(max) && filters.max)
    where.push(lte(priceExpr, Math.round(max * per)));

  /*
   * Approved-review aggregate, joined rather than fetched afterwards. Sorting
   * by rating used to happen in JavaScript over the whole result set, which
   * only worked while the whole result set was in memory — under a LIMIT it
   * would have sorted each batch against itself and silently mis-ordered the
   * catalogue.
   */
  const ratings = db
    .select({
      productId: reviews.productId,
      avg: sql<string>`avg(${reviews.rating})`.as("avg_rating"),
      count: sql<string>`count(*)`.as("review_count"),
    })
    .from(reviews)
    /*
     * Scoped to this shop, not to the platform. Postgres cannot push a join
     * key into a grouped subquery, so without this every catalogue read
     * hash-aggregates every approved review in the database — one shop's page
     * paying for every other shop's reviews, and getting slower as the fleet
     * grows rather than as its own catalogue does.
     */
    .where(and(eq(reviews.isApproved, true), eq(reviews.shopId, shopId)))
    .groupBy(reviews.productId)
    .as("ratings");

  const SORTS: Record<string, SQL[]> = {
    price_asc: [asc(priceExpr)],
    price_desc: [desc(priceExpr)],
    newest: [desc(products.createdAt)],
    oldest: [asc(products.createdAt)],
    // NULLS LAST keeps unreviewed products behind reviewed ones in both
    // engines' default, rather than at whichever end Postgres prefers.
    rating: [sql`${ratings.avg} desc nulls last`],
  };

  /*
   * `Object.hasOwn`, not a plain lookup with `??`.
   *
   * An object literal inherits from `Object.prototype`, so `SORTS["toString"]`
   * resolves to a *function* — `??` never fires, `orderBy` is not an array,
   * and the spread on the next line throws. `GET /anyshop?sort=toString` was
   * an unauthenticated 500 on every storefront in the fleet, and
   * `constructor`, `valueOf` and `__proto__` did the same.
   */
  const requested = filters.sort ?? "";
  const orderBy = (Object.hasOwn(SORTS, requested) ? SORTS[requested] : undefined) ?? [
        desc(products.isFeatured),
        asc(products.position),
        desc(products.createdAt),
      ];

  /*
   * Every sort ends on the primary key, so the order is total rather than
   * partial. Without it a batch boundary is undefined where the sort keys tie
   * — and they tie constantly: `position` defaults to 0, and Postgres gives
   * every row inserted by one CSV import the same `created_at`, because now()
   * is fixed for the transaction. A tie across a boundary repeats a product on
   * the next batch or drops it entirely.
   */
  const ordered = [...orderBy, asc(products.id)];

  const [idRows, totalRows] = await Promise.all([
    db
      .select({
        id: products.id,
        avg: ratings.avg,
        count: ratings.count,
      })
      .from(products)
      .leftJoin(ratings, eq(ratings.productId, products.id))
      .where(and(...where))
      .orderBy(...ordered)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<string>`count(*)` })
      .from(products)
      .where(and(...where)),
  ]);

  const total = Number(totalRows[0]?.total ?? 0);
  if (idRows.length === 0) return { items: [], total, nextOffset: null };

  const ids = idRows.map((r) => r.id);
  const rows = await db.query.products.findMany({
    where: inArray(products.id, ids),
    with: {
      images: { orderBy: [asc(productImages.position)] },
      category: true,
      // Cards quote "from" the cheapest variant and grey out a product whose
      // every combination has sold out, so they travel with the list.
      variants: { orderBy: [asc(productVariants.position)] },
    },
  });

  // `inArray` has no order of its own, so the batch is rebuilt in the order
  // the first query chose.
  const rating = new Map(idRows.map((r) => [r.id, r]));
  const items: ProductCard[] = orderByIds(ids, rows).map((product) => {
    // A product nobody has reviewed has no row on the left join, so both come
    // back null — which is a rating of "none", not a score of zero.
    const found = rating.get(product.id);
    const avg = found?.avg ?? null;
    const count = found?.count ?? null;
    return {
      ...inCurrency(product, currency, shopCurrency),
      avgRating: avg === null ? null : Number(avg),
      reviewCount: count === null ? 0 : Number(count),
    };
  });

  return { items, total, nextOffset: nextOffsetFor(offset, items.length, total) };
}

async function readProductBySlug(
  shopId: string,
  slug: string,
  currency: string,
  shopCurrency: string,
) {
  const db = getDb();
  const product = await db.query.products.findFirst({
    where: and(eq(products.shopId, shopId), eq(products.slug, slug)),
    with: {
      images: { orderBy: [asc(productImages.position)] },
      category: true,
      variants: { orderBy: [asc(productVariants.position)] },
      files: { orderBy: [asc(productFiles.position)] },
    },
  });
  if (!product) return null;

  const approved = await db.query.reviews.findMany({
    where: and(eq(reviews.productId, product.id), eq(reviews.isApproved, true)),
    orderBy: [desc(reviews.createdAt)],
  });

  const avg =
    approved.length > 0
      ? approved.reduce((sum, r) => sum + r.rating, 0) / approved.length
      : null;

  return {
    ...inCurrency(product, currency, shopCurrency),
    reviews: approved,
    avgRating: avg,
    reviewCount: approved.length,
  };
}

/**
 * The seller's own catalogue, with a safety ceiling.
 *
 * The Business plan has no product limit, and this loaded every row with its
 * images, its category and its variants — so the seller with the biggest
 * catalogue, who is the one paying most, got the slowest admin and eventually
 * a page that would not finish.
 *
 * A thousand, not two hundred. The first version of this capped low enough
 * that a real shop could reach it, and the page rendered the truncated count
 * as the whole catalogue — so a seller with five hundred products was told
 * they had two hundred and could not find the rest. Silent truncation is worse
 * than a slow page, because a slow page tells you something is wrong.
 *
 * This is a backstop against one shop taking the admin down, not pagination.
 * A catalogue that reaches it has outgrown a single page and the caller says
 * so rather than pretending otherwise — see `atProductLimit` at the call site.
 */
export const ADMIN_PRODUCT_LIMIT = 1_000;

export async function getAdminProducts(shopId: string, limit = ADMIN_PRODUCT_LIMIT) {
  /*
   * The predicate and the relation set are `@sailo/commerce/catalog`, shared
   * with the phone's `products.list`. What stays here is the ordering and the
   * ceiling, because they are this screen's: `position` first so a seller can
   * drag to reorder, and one page rather than a cursor for the same reason.
   */
  return sellerCatalogue({ shopId, limit });
}

/**
 * The edit page's prev/next arrows — this product's neighbours in the
 * catalogue, under the same ordering the list renders
 * (`position` first, newest after; see `sellerCatalogue`).
 *
 * Computed from the ordered id list rather than from two window queries,
 * because "next" must mean "the row under this one on the list page" even
 * when positions tie — and only replaying the list's own order can promise
 * that. Ids only, capped like the list, so a thousand-product shop pays for
 * a thousand uuids and not a thousand products.
 */
export async function adjacentProductIds(
  shopId: string,
  productId: string,
): Promise<{ prev: string | null; next: string | null }> {
  const rows = await getDb()
    .select({ id: products.id })
    .from(products)
    .where(eq(products.shopId, shopId))
    .orderBy(asc(products.position), desc(products.createdAt))
    .limit(ADMIN_PRODUCT_LIMIT);

  const at = rows.findIndex((row) => row.id === productId);
  if (at === -1) return { prev: null, next: null };
  return {
    prev: rows[at - 1]?.id ?? null,
    next: rows[at + 1]?.id ?? null,
  };
}

/** Everything the product editor needs to round-trip a product. */
/**
 * Everything the product editor needs to round-trip a product.
 *
 * `@sailo/commerce/catalog`'s, and the same read the phone's `products.get`
 * makes. The two were written separately and had drifted — the phone's omitted
 * `files` — which is exactly the shape of bug a shared read exists to prevent.
 */
export const getAdminProduct = sellerProduct;

/**
 * One page of a shop's public catalogue.
 *
 * The arguments are the cache key now — Next derives it from them — where
 * `cachedForShop` needed a hand-written key part and a `stringify` helper to
 * fold the filter object in. One fewer thing to get wrong: a filter that was
 * invisible to the old key would have served two different catalogues from
 * one entry.
 *
 * That hand-written key also carried a version suffix, because entries never
 * expire and a deploy changing the return shape met entries written by the
 * previous one. Arguments-as-key does not fix that on its own, so if the
 * shape of `ProductPage` changes again, bump `cacheTag` here rather than
 * hoping every shop is edited.
 */
export async function getPublicProducts(
  shopId: string,
  /**
   * What this visit is quoted in, and what the shop's own prices are in.
   *
   * Both are arguments and both are therefore in the cache key, which is the
   * whole reason they are passed rather than read: a currency left out of the
   * key serves one visitor's euro page to the next visitor in dollars.
   * `displayCurrency` in `lib/regional.ts` decides the first, outside every
   * cached scope, because deciding it reads a header and a cookie.
   */
  currency: string,
  shopCurrency: string,
  filters: ShopFilters = {},
  offset = 0,
  limit = PRODUCT_PAGE_SIZE,
): Promise<ProductPage> {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return readPublicProducts(shopId, currency, shopCurrency, filters, offset, limit);
}

/**
 * Drops the products the seller has asked to hide outside their sell window —
 * spec 43.
 *
 * **This is the answer to "which of the two cache options did you pick", and it
 * is the second: nothing about a sell window is decided inside a `"use cache"`
 * function.** `getPublicProducts` above is `cacheLife("max")` and keyed on its
 * arguments, so an entry never expires on a clock — a window boundary evaluated
 * in there would be frozen into a page that goes on showing a finished launch
 * until somebody happens to edit the shop. Three caches in this repo have
 * silently stopped working before, and a window that expires invisibly is the
 * same failure wearing different clothes.
 *
 * So the cached thing is the *rows* and the decision is taken here, per request,
 * against a fresh clock. The alternative — a `revalidate` bound to the nearest
 * boundary — would have meant computing that boundary across a whole catalogue
 * on every read and re-keying the entry whenever any product's window moved,
 * which is more machinery for a weaker guarantee.
 *
 * What it costs is honest and small: a batch can come back holding fewer than
 * `PRODUCT_PAGE_SIZE` cards, because the hidden ones were counted in SQL and
 * removed here. `total` is adjusted for what this batch dropped so the count
 * under the filter bar does not claim products nobody can see; `nextOffset` is
 * left alone, because it is an offset into the *query*, and moving it would
 * skip real products. A short page is a cosmetic cost. Selling something after
 * its window closed is not — and that is refused in `resolveLines` regardless
 * of anything decided here.
 */
export function visibleNow(page: ProductPage, now = new Date()): ProductPage {
  const items = page.items.filter(
    (product) => !hiddenOutsideWindow(product, null, now),
  );
  if (items.length === page.items.length) return page;

  return {
    items,
    total: Math.max(items.length, page.total - (page.items.length - items.length)),
    nextOffset: page.nextOffset,
  };
}

export async function getProductBySlug(
  shopId: string,
  slug: string,
  currency: string,
  shopCurrency: string,
) {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return readProductBySlug(shopId, slug, currency, shopCurrency);
}
