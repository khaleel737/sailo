import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, products, reviews, shops, type Shop } from "@/db/schema";
import { handleTag, shopTag } from "@/lib/cache";

/** The shop itself, and what it stocks — for building its storefront filters. */

async function readShopByHandle(handle: string): Promise<Shop | null> {
  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.handle, handle.toLowerCase()),
  });
  return shop ?? null;
}

async function readShopCategories(shopId: string) {
  return getDb().query.categories.findMany({
    where: eq(categories.shopId, shopId),
    orderBy: [asc(categories.position), asc(categories.name)],
  });
}

export type ShopFacets = {
  /** Kinds that actually appear, with how many of each. */
  kinds: { kind: string; count: number }[];
  /** Categories holding at least one published product. */
  categories: { id: string; name: string; slug: string; count: number }[];
  priceMinCents: number;
  priceMaxCents: number;
  /** True when filtering by stock could change the result. */
  hasOutOfStock: boolean;
  /** True when anything has an approved review, so sorting by rating means something. */
  hasReviews: boolean;
  total: number;
};

/**
 * What this shop actually sells, for building its filters.
 *
 * The filter bar used to advertise what Sailo supports rather than what the
 * seller stocks: a potter with eight mugs still got "Physical / Digital /
 * Services", a "Top rated" sort with no reviews to rank, an in-stock toggle
 * with nothing out of stock, and category chips for categories holding
 * nothing. Every one of those is a control that cannot change the result —
 * the shopper only finds that out by using it and landing on an empty page.
 *
 * So the controls are derived from the catalogue, and one that can't change
 * anything isn't rendered at all.
 */
export async function getShopFacets(shopId: string): Promise<ShopFacets> {
  const db = getDb();
  const published = and(eq(products.shopId, shopId), eq(products.isPublished, true));

  const [kindRows, categoryRows, [summary]] = await Promise.all([
    db
      .select({ kind: products.kind, count: sql<string>`count(*)` })
      .from(products)
      .where(published)
      .groupBy(products.kind)
      .orderBy(desc(sql`count(*)`)),

    db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        position: categories.position,
        count: sql<string>`count(${products.id})`,
      })
      .from(categories)
      .innerJoin(
        products,
        and(eq(products.categoryId, categories.id), eq(products.isPublished, true)),
      )
      .where(eq(categories.shopId, shopId))
      .groupBy(categories.id, categories.name, categories.slug, categories.position)
      .orderBy(asc(categories.position), asc(categories.name)),

    db
      .select({
        min: sql<string>`coalesce(min(${products.priceCents}), 0)`,
        max: sql<string>`coalesce(max(${products.priceCents}), 0)`,
        outOfStock: sql<string>`count(*) filter (where not ${products.inStock})`,
        total: sql<string>`count(*)`,
      })
      .from(products)
      .where(published),
  ]);

  // One row is enough to know the sort is worth offering.
  const [reviewed] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(and(eq(reviews.shopId, shopId), eq(reviews.isApproved, true)))
    .limit(1);

  return {
    kinds: kindRows.map((r) => ({ kind: r.kind, count: Number(r.count) })),
    categories: categoryRows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      count: Number(r.count),
    })),
    priceMinCents: Number(summary?.min ?? 0),
    priceMaxCents: Number(summary?.max ?? 0),
    hasOutOfStock: Number(summary?.outOfStock ?? 0) > 0,
    hasReviews: Boolean(reviewed),
    total: Number(summary?.total ?? 0),
  };
}

/* -------------------------------------------------------------------------- */
/*  Admin                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The handle → shop lookup, cached until the shop changes.
 *
 * `cacheLife("max")` rather than a duration: nothing here goes stale on a
 * clock. A shop's row changes when its owner edits it and at no other time, so
 * a timer would only mean re-reading Postgres to discover nothing moved — and
 * a short one would mean a seller waiting out a TTL to see their own typo fix.
 * `revalidateShop` is what expires these, on the write that made them wrong.
 */
export async function getShopByHandle(handle: string): Promise<Shop | null> {
  "use cache";
  cacheLife("max");
  cacheTag(handleTag(handle));
  return readShopByHandle(handle);
}

export async function getShopCategories(shopId: string) {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return readShopCategories(shopId);
}
