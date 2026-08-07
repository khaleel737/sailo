import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, productFiles, productImages, productVariants, products, reviews, type Category, type Product, type ProductImage, type ProductVariant } from "@/db/schema";
import { shopTag } from "@/lib/cache";
import { minorPerMajor } from "@/lib/currency";
import { nextOffsetFor, orderByIds } from "./pagination";

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
async function readPublicProducts(
  shopId: string,
  currency: string,
  filters: ShopFilters = {},
  offset = 0,
  limit = PRODUCT_PAGE_SIZE,
): Promise<ProductPage> {
  const db = getDb();
  const where = [eq(products.shopId, shopId), eq(products.isPublished, true)];

  if (filters.q?.trim()) {
    const term = `%${filters.q.trim()}%`;
    const match = or(
      ilike(products.title, term),
      ilike(products.description, term),
    );
    if (match) where.push(match);
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
    where.push(gte(products.priceCents, Math.round(min * per)));

  const max = Number(filters.max);
  if (Number.isFinite(max) && filters.max)
    where.push(lte(products.priceCents, Math.round(max * per)));

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
    price_asc: [asc(products.priceCents)],
    price_desc: [desc(products.priceCents)],
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
      ...product,
      avgRating: avg === null ? null : Number(avg),
      reviewCount: count === null ? 0 : Number(count),
    };
  });

  return { items, total, nextOffset: nextOffsetFor(offset, items.length, total) };
}

async function readProductBySlug(shopId: string, slug: string) {
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

  return { ...product, reviews: approved, avgRating: avg, reviewCount: approved.length };
}

/**
 * The seller's own catalogue, bounded.
 *
 * The Business plan has no product limit, and this loaded every row with its
 * images, its category and its variants — so the seller with the biggest
 * catalogue, who is the one paying most, got the slowest admin and eventually
 * a page that would not finish. A ceiling that is generous enough that almost
 * nobody meets it is better than none: the storefront has paginated since it
 * was written, and this is the same argument applied to the page behind it.
 */
export const ADMIN_PRODUCT_PAGE_SIZE = 200;

export async function getAdminProducts(shopId: string, limit = ADMIN_PRODUCT_PAGE_SIZE) {
  return getDb().query.products.findMany({
    where: eq(products.shopId, shopId),
    orderBy: [asc(products.position), desc(products.createdAt)],
    limit,
    with: {
      images: { orderBy: [asc(productImages.position)] },
      category: true,
      variants: { orderBy: [asc(productVariants.position)] },
    },
  });
}

/** Everything the product editor needs to round-trip a product. */
export async function getAdminProduct(shopId: string, id: string) {
  const product = await getDb().query.products.findFirst({
    where: and(eq(products.id, id), eq(products.shopId, shopId)),
    with: {
      images: { orderBy: [asc(productImages.position)] },
      variants: { orderBy: [asc(productVariants.position)] },
      files: { orderBy: [asc(productFiles.position)] },
    },
  });
  return product ?? null;
}

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
  currency: string,
  filters: ShopFilters = {},
  offset = 0,
  limit = PRODUCT_PAGE_SIZE,
): Promise<ProductPage> {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return readPublicProducts(shopId, currency, filters, offset, limit);
}

export async function getProductBySlug(shopId: string, slug: string) {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return readProductBySlug(shopId, slug);
}
