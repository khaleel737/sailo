import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "@/db";
import {
  categories,
  orders,
  productImages,
  products,
  reviews,
  shops,
  visits,
  type Category,
  type Product,
  type ProductImage,
  type Shop,
} from "@/db/schema";

export type ProductCard = Product & {
  images: ProductImage[];
  category: Category | null;
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

export async function getShopByHandle(handle: string): Promise<Shop | null> {
  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.handle, handle.toLowerCase()),
  });
  return shop ?? null;
}

export async function getShopCategories(shopId: string) {
  return getDb().query.categories.findMany({
    where: eq(categories.shopId, shopId),
    orderBy: [asc(categories.position), asc(categories.name)],
  });
}

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
export async function getPublicProducts(
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

export async function getProductBySlug(shopId: string, slug: string) {
  const db = getDb();
  const product = await db.query.products.findFirst({
    where: and(eq(products.shopId, shopId), eq(products.slug, slug)),
    with: {
      images: { orderBy: [asc(productImages.position)] },
      category: true,
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

/** Distinct price bounds so the filter UI can show a real range. */
export async function getPriceBounds(shopId: string) {
  const [row] = await getDb()
    .select({
      min: sql<string>`coalesce(min(${products.priceCents}), 0)`,
      max: sql<string>`coalesce(max(${products.priceCents}), 0)`,
    })
    .from(products)
    .where(and(eq(products.shopId, shopId), eq(products.isPublished, true)));

  return { min: Number(row?.min ?? 0), max: Number(row?.max ?? 0) };
}

/* -------------------------------------------------------------------------- */
/*  Admin                                                                      */
/* -------------------------------------------------------------------------- */

export async function getDashboardStats(shopId: string) {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [[visitRow], [orderRow], [productRow], [reviewRow]] = await Promise.all([
    db
      .select({
        total: sql<string>`count(*)`,
        unique: sql<string>`count(distinct ${visits.sessionId})`,
      })
      .from(visits)
      .where(and(eq(visits.shopId, shopId), gte(visits.createdAt, since))),
    db
      .select({
        total: sql<string>`count(*)`,
        pending: sql<string>`count(*) filter (where ${orders.status} = 'new')`,
        revenue: sql<string>`coalesce(sum(${orders.unitPriceCents} * ${orders.quantity}), 0)`,
      })
      .from(orders)
      .where(eq(orders.shopId, shopId)),
    db
      .select({
        total: sql<string>`count(*)`,
        published: sql<string>`count(*) filter (where ${products.isPublished})`,
      })
      .from(products)
      .where(eq(products.shopId, shopId)),
    db
      .select({
        pending: sql<string>`count(*) filter (where not ${reviews.isApproved})`,
      })
      .from(reviews)
      .where(eq(reviews.shopId, shopId)),
  ]);

  return {
    visits30d: Number(visitRow?.total ?? 0),
    uniqueVisitors30d: Number(visitRow?.unique ?? 0),
    totalOrders: Number(orderRow?.total ?? 0),
    newOrders: Number(orderRow?.pending ?? 0),
    orderValueCents: Number(orderRow?.revenue ?? 0),
    totalProducts: Number(productRow?.total ?? 0),
    publishedProducts: Number(productRow?.published ?? 0),
    pendingReviews: Number(reviewRow?.pending ?? 0),
  };
}

/** Daily visit counts for the last N days, zero-filled for the chart. */
export async function getVisitSeries(shopId: string, days = 14) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${visits.createdAt}::date, 'YYYY-MM-DD')`,
      count: sql<string>`count(*)`,
    })
    .from(visits)
    .where(and(eq(visits.shopId, shopId), gte(visits.createdAt, since)))
    .groupBy(sql`${visits.createdAt}::date`)
    .orderBy(sql`${visits.createdAt}::date`);

  const counts = new Map(rows.map((r) => [r.day, Number(r.count)]));
  const series: { day: string; count: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, count: counts.get(key) ?? 0 });
  }
  return series;
}

export async function getShopOrders(shopId: string, limit = 100) {
  return getDb().query.orders.findMany({
    where: eq(orders.shopId, shopId),
    orderBy: [desc(orders.createdAt)],
    limit,
  });
}

/**
 * "Clients" are derived from order intents — we key on contact when we have
 * one, otherwise on name, so repeat buyers collapse into a single row.
 */
export async function getShopClients(shopId: string) {
  const rows = await getShopOrders(shopId, 500);
  const map = new Map<
    string,
    {
      key: string;
      name: string;
      contact: string | null;
      orderCount: number;
      totalCents: number;
      lastOrderAt: Date;
    }
  >();

  for (const o of rows) {
    const key = (o.customerContact || o.customerName || "").trim().toLowerCase();
    if (!key) continue;
    const existing = map.get(key);
    const value = o.unitPriceCents * o.quantity;
    if (existing) {
      existing.orderCount += 1;
      existing.totalCents += value;
      if (o.createdAt > existing.lastOrderAt) existing.lastOrderAt = o.createdAt;
    } else {
      map.set(key, {
        key,
        name: o.customerName || "Anonymous",
        contact: o.customerContact,
        orderCount: 1,
        totalCents: value,
        lastOrderAt: o.createdAt,
      });
    }
  }

  return [...map.values()].sort(
    (a, b) => b.lastOrderAt.getTime() - a.lastOrderAt.getTime(),
  );
}

export async function getAdminProducts(shopId: string) {
  return getDb().query.products.findMany({
    where: eq(products.shopId, shopId),
    orderBy: [asc(products.position), desc(products.createdAt)],
    with: {
      images: { orderBy: [asc(productImages.position)] },
      category: true,
    },
  });
}

export async function getShopReviews(shopId: string) {
  const db = getDb();
  const rows = await db.query.reviews.findMany({
    where: eq(reviews.shopId, shopId),
    orderBy: [desc(reviews.createdAt)],
    limit: 200,
  });

  const ids = [...new Set(rows.map((r) => r.productId))];
  const titles = new Map<string, string>();
  if (ids.length) {
    const prods = await db
      .select({ id: products.id, title: products.title })
      .from(products)
      .where(inArray(products.id, ids));
    for (const p of prods) titles.set(p.id, p.title);
  }

  return rows.map((r) => ({ ...r, productTitle: titles.get(r.productId) ?? "Deleted product" }));
}
