import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  categories,
  productFiles,
  productImages,
  productVariants,
  products,
  reviews,
  type Category,
  type Product,
  type ProductImage,
  type ProductVariant,
} from "@/db/schema";
import { cachedForShop, shopTag } from "@/lib/cache";

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

/** Rating aggregates keyed by product id — approved reviews only. */
async function getRatings(productIds: string[]) {
  const map = new Map<string, { avg: number; count: number }>();
  if (productIds.length === 0) return map;

  const rows = await getDb()
    .select({
      productId: reviews.productId,
      avg: sql<string>`avg(${reviews.rating})`,
      count: sql<string>`count(*)`,
    })
    .from(reviews)
    .where(
      and(inArray(reviews.productId, productIds), eq(reviews.isApproved, true)),
    )
    .groupBy(reviews.productId);

  for (const r of rows) {
    map.set(r.productId, { avg: Number(r.avg), count: Number(r.count) });
  }
  return map;
}

/**
 * The public catalog query — search, category, kind, price range and sort all
 * resolve here so the template stays a dumb renderer.
 */
async function readPublicProducts(
  shopId: string,
  filters: ShopFilters = {},
): Promise<ProductCard[]> {
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
    if (!cat) return [];
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

  const orderBy = {
    price_asc: [asc(products.priceCents)],
    price_desc: [desc(products.priceCents)],
    newest: [desc(products.createdAt)],
    oldest: [asc(products.createdAt)],
  }[filters.sort ?? ""] ?? [
    desc(products.isFeatured),
    asc(products.position),
    desc(products.createdAt),
  ];

  const rows = await db.query.products.findMany({
    where: and(...where),
    orderBy,
    with: {
      images: { orderBy: [asc(productImages.position)] },
      category: true,
      // Cards quote "from" the cheapest variant and grey out a product whose
      // every combination has sold out, so they travel with the list.
      variants: { orderBy: [asc(productVariants.position)] },
    },
  });

  const ratings = await getRatings(rows.map((r) => r.id));

  let cards: ProductCard[] = rows.map((r) => ({
    ...r,
    avgRating: ratings.get(r.id)?.avg ?? null,
    reviewCount: ratings.get(r.id)?.count ?? 0,
  }));

  if (filters.sort === "rating") {
    cards = [...cards].sort((a, b) => (b.avgRating ?? -1) - (a.avgRating ?? -1));
  }

  return cards;
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

export const getPublicProducts = cachedForShop(
  ["public-products"],
  readPublicProducts,
  (shopId) => [shopTag(shopId)],
);

export const getProductBySlug = cachedForShop(
  ["product-by-slug"],
  readProductBySlug,
  (shopId) => [shopTag(shopId)],
);
