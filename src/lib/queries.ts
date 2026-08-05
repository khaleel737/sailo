import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { can } from "@/lib/plans";
import { orderLines, orderLinesMap } from "@/lib/order-lines";
import { isRailUsable } from "@/lib/payments";
import {
  affiliates,
  categories,
  clients,
  coupons,
  deliveryMethods,
  invoices,
  orders,
  paymentMethods,
  productFiles,
  productImages,
  products,
  productVariants,
  reviews,
  shops,
  visits,
  type Affiliate,
  type Category,
  type Client,
  type Order,
  type Product,
  type ProductImage,
  type ProductVariant,
  type Shop,
} from "@/db/schema";
import { type PaymentMethodType } from "./payments";
import { isDeliveryConfigured, type DeliveryMethodType } from "./delivery";

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

export async function getProductBySlug(shopId: string, slug: string) {
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

export async function getDashboardStats(shopId: string, windowDays = 30) {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

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
        // Cancelled orders never counted; refunds come straight off the top.
        gross: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
        refunded: sql<string>`coalesce(sum(${orders.refundedCents}), 0)`,
        refundCount: sql<string>`count(*) filter (where ${orders.refundedCents} > 0)`,
        paid: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${orders.paymentStatus} = 'paid'), 0)`,
        awaitingConfirm: sql<string>`count(*) filter (where ${orders.paymentStatus} = 'pending')`,
        awaitingShipment: sql<string>`count(*) filter (where ${orders.deliveryMethod} = 'shipping' and ${orders.status} in ('new','confirmed'))`,
        unpaidCommission: sql<string>`coalesce(sum(${orders.commissionCents}) filter (where not ${orders.commissionPaid}), 0)`,
        // Tax the seller has collected and owes on. Cancelled orders never
        // happened; a refund hands the tax back with the rest of the money.
        tax: sql<string>`coalesce(sum(${orders.taxCents}) filter (where ${orders.status} <> 'cancelled' and ${orders.refundedCents} = 0), 0)`,
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
    visitsInRange: Number(visitRow?.total ?? 0),
    uniqueVisitorsInRange: Number(visitRow?.unique ?? 0),
    totalOrders: Number(orderRow?.total ?? 0),
    newOrders: Number(orderRow?.pending ?? 0),
    grossCents: Number(orderRow?.gross ?? 0),
    refundedCents: Number(orderRow?.refunded ?? 0),
    netRevenueCents:
      Number(orderRow?.gross ?? 0) - Number(orderRow?.refunded ?? 0),
    refundCount: Number(orderRow?.refundCount ?? 0),
    paidValueCents: Number(orderRow?.paid ?? 0),
    awaitingConfirmation: Number(orderRow?.awaitingConfirm ?? 0),
    awaitingShipment: Number(orderRow?.awaitingShipment ?? 0),
    unpaidCommissionCents: Number(orderRow?.unpaidCommission ?? 0),
    taxCollectedCents: Number(orderRow?.tax ?? 0),
    totalProducts: Number(productRow?.total ?? 0),
    publishedProducts: Number(productRow?.published ?? 0),
    pendingReviews: Number(reviewRow?.pending ?? 0),
  };
}

/**
 * Timestamps are stored as UTC wall-clock, and Postgres `::date` truncates in
 * UTC — so the JS buckets must be built in UTC too. Using local midnight here
 * silently drops today's bucket for anyone ahead of UTC.
 */
function utcDayWindow(days: number) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return { since, keys };
}

/** Daily visit counts for the last N days, zero-filled for the chart. */
export async function getVisitSeries(shopId: string, days = 14) {
  const { since, keys } = utcDayWindow(days);

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
  return keys.map((day) => ({ day, count: counts.get(day) ?? 0 }));
}

/**
 * Daily net revenue for the last N days, zero-filled. Refunds are subtracted
 * on the day the order was placed so a day's bar reflects what it truly earned.
 */
export async function getRevenueSeries(shopId: string, days = 14) {
  const { since, keys } = utcDayWindow(days);

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${orders.createdAt}::date, 'YYYY-MM-DD')`,
      cents: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} <> 'cancelled'), 0) - coalesce(sum(${orders.refundedCents}), 0)`,
    })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), gte(orders.createdAt, since)))
    .groupBy(sql`${orders.createdAt}::date`)
    .orderBy(sql`${orders.createdAt}::date`);

  const byDay = new Map(rows.map((r) => [r.day, Number(r.cents)]));
  return keys.map((day) => ({ day, cents: byDay.get(day) ?? 0 }));
}

/**
 * Where a shop's visitors come from, over the same window as the charts.
 *
 * One pass over the visits table per dimension. Each is `count(*)` grouped and
 * ordered, capped at a handful of rows — a seller acts on the top few and a
 * long tail of one-visit referrers is noise.
 */
export async function getVisitBreakdown(shopId: string, days = 30, limit = 6) {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const scope = and(eq(visits.shopId, shopId), gte(visits.createdAt, since));

  /** Grouped counts for one column, ignoring rows where it's null. */
  const top = async <T extends AnyPgColumn>(column: T) =>
    db
      .select({
        key: sql<string>`${column}`,
        count: sql<string>`count(*)`,
        unique: sql<string>`count(distinct ${visits.sessionId})`,
      })
      .from(visits)
      .where(and(scope, isNotNull(column)))
      .groupBy(sql`${column}`)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);

  const [countries, cities, sources, referrers, devices, campaigns, totals] =
    await Promise.all([
      top(visits.country),
      // A city name is only meaningful with its country — "Springfield" alone
      // could be any of dozens.
      db
        .select({
          key: sql<string>`${visits.city}`,
          country: sql<string>`max(${visits.country})`,
          count: sql<string>`count(*)`,
          unique: sql<string>`count(distinct ${visits.sessionId})`,
        })
        .from(visits)
        .where(and(scope, isNotNull(visits.city)))
        .groupBy(sql`${visits.city}`)
        .orderBy(desc(sql`count(*)`))
        .limit(limit),
      top(visits.source),
      top(visits.referrerHost),
      top(visits.device),
      db
        .select({
          key: sql<string>`coalesce(${visits.utmCampaign}, ${visits.utmSource})`,
          medium: sql<string>`max(${visits.utmMedium})`,
          source: sql<string>`max(${visits.utmSource})`,
          count: sql<string>`count(*)`,
          unique: sql<string>`count(distinct ${visits.sessionId})`,
        })
        .from(visits)
        .where(
          and(
            scope,
            or(isNotNull(visits.utmCampaign), isNotNull(visits.utmSource)),
          ),
        )
        .groupBy(sql`coalesce(${visits.utmCampaign}, ${visits.utmSource})`)
        .orderBy(desc(sql`count(*)`))
        .limit(limit),
      db
        .select({
          count: sql<string>`count(*)`,
          unique: sql<string>`count(distinct ${visits.sessionId})`,
          located: sql<string>`count(*) filter (where ${visits.country} is not null)`,
        })
        .from(visits)
        .where(scope),
    ]);

  const rows = <R extends { key: string; count: string; unique: string }>(list: R[]) =>
    list.map((r) => ({
      ...r,
      count: Number(r.count),
      unique: Number(r.unique),
    }));

  return {
    total: Number(totals[0]?.count ?? 0),
    unique: Number(totals[0]?.unique ?? 0),
    /** Visits the edge could place. Zero in local development. */
    located: Number(totals[0]?.located ?? 0),
    countries: rows(countries),
    cities: rows(cities),
    sources: rows(sources),
    referrers: rows(referrers),
    devices: rows(devices),
    campaigns: rows(campaigns),
  };
}

export type VisitBreakdown = Awaited<ReturnType<typeof getVisitBreakdown>>;

/**
 * An order's lines. Delegates to `order-lines`, which is the only module
 * allowed to decide what an order contains — see the note there on why the
 * header columns are not a second source of truth.
 */
export async function getOrderItems(order: Order) {
  return orderLines(order);
}

/** The same, for a list of orders, in one query rather than one each. */
export async function getOrderItemsMap(orders: Order[]) {
  return orderLinesMap(orders);
}


export async function getShopOrders(shopId: string, limit = 100) {
  return getDb().query.orders.findMany({
    where: eq(orders.shopId, shopId),
    orderBy: [desc(orders.createdAt)],
    limit,
  });
}

export type ClientRow = Client & {
  orderCount: number;
  totalCents: number;
  lastOrderAt: Date | null;
};

/** Clients with their lifetime totals, most recently active first. */
export async function getShopClients(shopId: string): Promise<ClientRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      client: clients,
      orderCount: sql<string>`count(${orders.id})`,
      // Lifetime value is net of refunds.
      totalCents: sql<string>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
      lastOrderAt: sql<string | null>`max(${orders.createdAt})`,
    })
    .from(clients)
    .leftJoin(orders, eq(orders.clientId, clients.id))
    .where(eq(clients.shopId, shopId))
    .groupBy(clients.id)
    .orderBy(sql`max(${orders.createdAt}) desc nulls last`);

  return rows.map((r) => ({
    ...r.client,
    orderCount: Number(r.orderCount),
    totalCents: Number(r.totalCents),
    lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt) : null,
  }));
}

export async function getClientWithOrders(shopId: string, clientId: string) {
  const db = getDb();

  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.shopId, shopId)),
  });
  if (!client) return null;

  const clientOrders = await db.query.orders.findMany({
    where: and(eq(orders.clientId, clientId), eq(orders.shopId, shopId)),
    orderBy: [desc(orders.createdAt)],
  });

  const active = clientOrders.filter((o) => o.status !== "cancelled");
  const totalCents = active.reduce(
    (sum, o) => sum + o.totalCents - o.refundedCents,
    0,
  );
  const paidCents = active
    .filter((o) => o.paymentStatus === "paid")
    .reduce((sum, o) => sum + o.totalCents, 0);
  const refundedCents = clientOrders.reduce((sum, o) => sum + o.refundedCents, 0);

  return {
    client,
    orders: clientOrders,
    totalCents,
    paidCents,
    refundedCents,
    // Never show a negative balance owed.
    outstandingCents: Math.max(0, totalCents - paidCents),
  };
}

/* -------------------------------------------------------------------------- */
/*  Payment methods                                                            */
/* -------------------------------------------------------------------------- */

export async function getShopPaymentMethods(shopId: string) {
  return getDb().query.paymentMethods.findMany({
    where: eq(paymentMethods.shopId, shopId),
    orderBy: [asc(paymentMethods.position)],
  });
}

/** Only rails a buyer can actually use — enabled and fully configured. */
export async function getCheckoutMethods(shopId: string) {
  const [rows, shop] = await Promise.all([
    getDb().query.paymentMethods.findMany({
      where: and(
        eq(paymentMethods.shopId, shopId),
        eq(paymentMethods.isEnabled, true),
      ),
      orderBy: [asc(paymentMethods.position)],
    }),
    getDb().query.shops.findFirst({ where: eq(shops.id, shopId) }),
  ]);
  if (!shop) return [];

  // A downgrade has to take the card button off the storefront, not just grey
  // it out in admin — the entitlement is checked here, where buyers read it.
  const cardAllowed = can(shop, "cardRails");

  return rows.filter((m) => {
    if (m.type === "card" && !cardAllowed) return false;
    return isRailUsable(m.type, m.config, shop);
  });
}

/* -------------------------------------------------------------------------- */
/*  Delivery                                                                   */
/* -------------------------------------------------------------------------- */

export async function getShopDeliveryMethods(shopId: string) {
  return getDb().query.deliveryMethods.findMany({
    where: eq(deliveryMethods.shopId, shopId),
    orderBy: [asc(deliveryMethods.position)],
  });
}

export async function getCheckoutDeliveryMethods(shopId: string) {
  const rows = await getDb().query.deliveryMethods.findMany({
    where: and(
      eq(deliveryMethods.shopId, shopId),
      eq(deliveryMethods.isEnabled, true),
    ),
    orderBy: [asc(deliveryMethods.position)],
  });
  return rows.filter((d) => isDeliveryConfigured(d.type, d.config));
}

/** Both checkout option lists in the shape the order sheet expects. */
export async function getCheckoutOptions(shopId: string) {
  const [payment, delivery] = await Promise.all([
    getCheckoutMethods(shopId),
    getCheckoutDeliveryMethods(shopId),
  ]);

  return {
    methods: payment.map((m) => ({
      type: m.type as PaymentMethodType,
      label: m.label,
    })),
    deliveryOptions: delivery.map((d) => ({
      id: d.id,
      type: d.type as DeliveryMethodType,
      name: d.name,
      feeCents: d.feeCents,
      freeOverCents: d.freeOverCents,
      estimate: d.config.estimate,
      address: d.config.address,
      hours: d.config.hours,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/*  Coupons                                                                    */
/* -------------------------------------------------------------------------- */

export async function getShopCoupons(shopId: string) {
  return getDb().query.coupons.findMany({
    where: eq(coupons.shopId, shopId),
    orderBy: [desc(coupons.createdAt)],
  });
}

/* -------------------------------------------------------------------------- */
/*  Affiliates                                                                 */
/* -------------------------------------------------------------------------- */

export type AffiliateRow = Affiliate & {
  orderCount: number;
  salesCents: number;
  earnedCents: number;
  unpaidCents: number;
};

export async function getShopAffiliates(shopId: string): Promise<AffiliateRow[]> {
  const rows = await getDb()
    .select({
      affiliate: affiliates,
      orderCount: sql<string>`count(${orders.id})`,
      salesCents: sql<string>`coalesce(sum(${orders.totalCents}), 0)`,
      earnedCents: sql<string>`coalesce(sum(${orders.commissionCents}), 0)`,
      unpaidCents: sql<string>`coalesce(sum(${orders.commissionCents}) filter (where not ${orders.commissionPaid}), 0)`,
    })
    .from(affiliates)
    .leftJoin(orders, eq(orders.affiliateId, affiliates.id))
    .where(eq(affiliates.shopId, shopId))
    .groupBy(affiliates.id)
    .orderBy(sql`coalesce(sum(${orders.commissionCents}), 0) desc`);

  return rows.map((r) => ({
    ...r.affiliate,
    orderCount: Number(r.orderCount),
    salesCents: Number(r.salesCents),
    earnedCents: Number(r.earnedCents),
    unpaidCents: Number(r.unpaidCents),
  }));
}

export async function getAffiliateByCode(shopId: string, code: string) {
  return getDb().query.affiliates.findFirst({
    where: and(
      eq(affiliates.shopId, shopId),
      eq(affiliates.code, code.toUpperCase()),
      eq(affiliates.status, "active"),
    ),
  });
}

/* -------------------------------------------------------------------------- */
/*  Invoices                                                                   */
/* -------------------------------------------------------------------------- */

/** Public lookup by token — returns everything the invoice page renders. */
export async function getInvoiceByToken(token: string) {
  const db = getDb();

  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.token, token),
  });
  if (!invoice) return null;

  const [order, shop] = await Promise.all([
    db.query.orders.findFirst({ where: eq(orders.id, invoice.orderId) }),
    db.query.shops.findFirst({ where: eq(shops.id, invoice.shopId) }),
  ]);
  if (!order || !shop) return null;

  return { invoice, order, shop, items: await getOrderItems(order) };
}

export async function getInvoiceForOrder(orderId: string) {
  return getDb().query.invoices.findFirst({
    where: eq(invoices.orderId, orderId),
  });
}

/** Invoice numbers keyed by order id, for listing screens. */
export async function getInvoiceMap(orderIds: string[]) {
  const map = new Map<string, { number: string; token: string }>();
  if (orderIds.length === 0) return map;

  const rows = await getDb()
    .select({
      orderId: invoices.orderId,
      number: invoices.number,
      token: invoices.token,
    })
    .from(invoices)
    .where(inArray(invoices.orderId, orderIds));

  for (const r of rows) map.set(r.orderId, { number: r.number, token: r.token });
  return map;
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
