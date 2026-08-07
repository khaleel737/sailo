import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, productFiles, productImages, productVariants, products, reviews, type Category, type Product, type ProductImage, type ProductVariant } from "@/db/schema";
import { shopTag } from "@/lib/cache";
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

  const min = Number(filters.min);
  if (Number.isFinite(min) && filters.min)
    where.push(gte(products.priceCents, Math.round(min * 100)));

  const max = Number(filters.max);
  if (Number.isFinite(max) && filters.max)
    where.push(lte(products.priceCents, Math.round(max * 100)));

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
    .where(eq(reviews.isApproved, true))
    .groupBy(reviews.productId)
    .as("ratings");

  const orderBy = {
    price_asc: [asc(products.priceCents)],
    price_desc: [desc(products.priceCents)],
    newest: [desc(products.createdAt)],
    oldest: [asc(products.createdAt)],
    // NULLS LAST keeps unreviewed products behind reviewed ones in both
    // engines' default, rather than at whichever end Postgres prefers.
    rating: [sql`${ratings.avg} desc nulls last`],
  }[filters.sort ?? ""] ?? [
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

export async function getAdminProducts(shopId: string) {
  return getDb().query.products.findMany({
    where: eq(products.shopId, shopId),
    orderBy: [asc(products.position), desc(products.createdAt)],
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
  filters: ShopFilters = {},
  offset = 0,
  limit = PRODUCT_PAGE_SIZE,
): Promise<ProductPage> {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return readPublicProducts(shopId, filters, offset, limit);
}

export async function getProductBySlug(shopId: string, slug: string) {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return readProductBySlug(shopId, slug);
}
