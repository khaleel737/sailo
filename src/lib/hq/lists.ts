import "server-only";
import { and, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { affiliates, clients, orders, products, shops, user } from "@/db/schema";
import { HQ_PAGE_SIZE, like, num, paginate } from "./pagination";
import { daysAgo } from "./pagination";
import { mergeCurrencyTotals } from "@/lib/hq-metrics";

/** Platform-wide lists: every order, product, affiliate and buyer. */

export type ListFilters = {
  q?: string;
  page?: number;
  status?: string;
  payment?: string;
  kind?: string;
  days?: number;
};

const ORDER_STATUSES = new Set([
  "new",
  "confirmed",
  "shipped",
  "completed",
  "cancelled",
  "refunded",
]);

const PAYMENT_STATUSES = new Set(["unpaid", "pending", "paid"]);

export async function getPlatformOrders(filters: ListFilters = {}) {
  const db = getDb();

  const clauses: (SQL | undefined)[] = [];
  if (filters.q?.trim()) {
    const pattern = like(filters.q);
    clauses.push(
      or(
        ilike(orders.customerName, pattern),
        ilike(orders.customerEmail, pattern),
        ilike(orders.productTitle, pattern),
        ilike(shops.handle, pattern),
        ilike(shops.name, pattern),
      ),
    );
  }
  if (filters.status && ORDER_STATUSES.has(filters.status)) {
    clauses.push(eq(orders.status, filters.status));
  }
  if (filters.payment && PAYMENT_STATUSES.has(filters.payment)) {
    clauses.push(eq(orders.paymentStatus, filters.payment));
  }
  if (filters.days && filters.days > 0) {
    clauses.push(gte(orders.createdAt, daysAgo(filters.days)));
  }
  const where = clauses.length > 0 ? and(...clauses.filter(Boolean)) : undefined;

  const [result, currencyRows] = await Promise.all([
    paginate(
      filters.page ?? 1,
      (offset) =>
        db
          .select({
            order: orders,
            shopName: shops.name,
            shopHandle: shops.handle,
            ownerId: shops.userId,
            ownerEmail: user.email,
          })
          .from(orders)
          .innerJoin(shops, eq(shops.id, orders.shopId))
          .innerJoin(user, eq(user.id, shops.userId))
          .where(where)
          .orderBy(desc(orders.createdAt))
          .limit(HQ_PAGE_SIZE)
          .offset(offset),

      async () => {
        const [totals] = await db
          .select({ n: sql<string>`count(*)` })
          .from(orders)
          .innerJoin(shops, eq(shops.id, orders.shopId))
          .innerJoin(user, eq(user.id, shops.userId))
          .where(where);
        return num(totals?.n);
      },
    ),

    // Volume for the whole filtered set, not just the page being shown.
    db
      .select({
        currency: orders.currency,
        cents: sql<string>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
      })
      .from(orders)
      .innerJoin(shops, eq(shops.id, orders.shopId))
      .innerJoin(user, eq(user.id, shops.userId))
      .where(where)
      .groupBy(orders.currency),
  ]);

  return {
    ...result,
    volume: mergeCurrencyTotals(
      currencyRows.map((r) => ({ currency: r.currency, cents: num(r.cents) })),
    ),
  };
}

export async function getPlatformProducts(filters: ListFilters = {}) {
  const db = getDb();

  const clauses: (SQL | undefined)[] = [];
  if (filters.q?.trim()) {
    const pattern = like(filters.q);
    clauses.push(
      or(
        ilike(products.title, pattern),
        ilike(shops.handle, pattern),
        ilike(shops.name, pattern),
      ),
    );
  }
  if (filters.kind && ["physical", "digital", "service"].includes(filters.kind)) {
    clauses.push(eq(products.kind, filters.kind));
  }
  if (filters.status === "published") clauses.push(eq(products.isPublished, true));
  if (filters.status === "hidden") clauses.push(eq(products.isPublished, false));
  const where = clauses.length > 0 ? and(...clauses.filter(Boolean)) : undefined;

  const result = await paginate(
    filters.page ?? 1,
    (offset) =>
      db
        .select({
          product: products,
          shopName: shops.name,
          shopHandle: shops.handle,
          currency: shops.currency,
          ownerId: shops.userId,
          orderCount: sql<string>`(select count(*) from order_items oi where oi.product_id = products.id)`,
        })
        .from(products)
        .innerJoin(shops, eq(shops.id, products.shopId))
        .where(where)
        .orderBy(desc(products.createdAt))
        .limit(HQ_PAGE_SIZE)
        .offset(offset),

    async () => {
      const [totals] = await db
        .select({ n: sql<string>`count(*)` })
        .from(products)
        .innerJoin(shops, eq(shops.id, products.shopId))
        .where(where);
      return num(totals?.n);
    },
  );

  return {
    ...result,
    rows: result.rows.map((r) => ({ ...r, orderCount: num(r.orderCount) })),
  };
}

export async function getPlatformAffiliates(filters: ListFilters = {}) {
  const db = getDb();

  const clauses: (SQL | undefined)[] = [];
  if (filters.q?.trim()) {
    const pattern = like(filters.q);
    clauses.push(
      or(
        ilike(affiliates.name, pattern),
        ilike(affiliates.email, pattern),
        ilike(affiliates.code, pattern),
        ilike(shops.handle, pattern),
      ),
    );
  }
  if (
    filters.status &&
    ["pending", "active", "disabled"].includes(filters.status)
  ) {
    clauses.push(eq(affiliates.status, filters.status));
  }
  const where = clauses.length > 0 ? and(...clauses.filter(Boolean)) : undefined;

  const earnedCents = sql<string>`(select coalesce(sum(o.commission_cents), 0) from orders o where o.affiliate_id = affiliates.id)`;

  const result = await paginate(
    filters.page ?? 1,
    (offset) =>
      db
        .select({
          affiliate: affiliates,
          shopName: shops.name,
          shopHandle: shops.handle,
          currency: shops.currency,
          ownerId: shops.userId,
          orderCount: sql<string>`(select count(*) from orders o where o.affiliate_id = affiliates.id)`,
          salesCents: sql<string>`(select coalesce(sum(o.total_cents), 0) from orders o where o.affiliate_id = affiliates.id and o.status <> 'cancelled')`,
          earnedCents,
          unpaidCents: sql<string>`(select coalesce(sum(o.commission_cents), 0) from orders o where o.affiliate_id = affiliates.id and not o.commission_paid)`,
        })
        .from(affiliates)
        .innerJoin(shops, eq(shops.id, affiliates.shopId))
        .where(where)
        .orderBy(desc(earnedCents))
        .limit(HQ_PAGE_SIZE)
        .offset(offset),

    async () => {
      const [totals] = await db
        .select({ n: sql<string>`count(*)` })
        .from(affiliates)
        .innerJoin(shops, eq(shops.id, affiliates.shopId))
        .where(where);
      return num(totals?.n);
    },
  );

  return {
    ...result,
    rows: result.rows.map((r) => ({
      ...r,
      orderCount: num(r.orderCount),
      salesCents: num(r.salesCents),
      earnedCents: num(r.earnedCents),
      unpaidCents: num(r.unpaidCents),
    })),
  };
}

export async function getPlatformBuyers(filters: ListFilters = {}) {
  const db = getDb();

  const clauses: (SQL | undefined)[] = [];
  if (filters.q?.trim()) {
    const pattern = like(filters.q);
    clauses.push(
      or(
        ilike(clients.name, pattern),
        ilike(clients.email, pattern),
        ilike(clients.phone, pattern),
        ilike(shops.handle, pattern),
      ),
    );
  }
  const where = clauses.length > 0 ? and(...clauses.filter(Boolean)) : undefined;

  const spentCents = sql<string>`(select coalesce(sum(o.total_cents - o.refunded_cents), 0) from orders o where o.client_id = clients.id and o.status <> 'cancelled')`;

  const result = await paginate(
    filters.page ?? 1,
    (offset) =>
      db
        .select({
          client: clients,
          shopName: shops.name,
          shopHandle: shops.handle,
          currency: shops.currency,
          ownerId: shops.userId,
          orderCount: sql<string>`(select count(*) from orders o where o.client_id = clients.id)`,
          spentCents,
          lastOrderAt: sql<
            string | null
          >`(select max(o.created_at) from orders o where o.client_id = clients.id)`,
        })
        .from(clients)
        .innerJoin(shops, eq(shops.id, clients.shopId))
        .where(where)
        .orderBy(desc(spentCents))
        .limit(HQ_PAGE_SIZE)
        .offset(offset),

    async () => {
      const [totals] = await db
        .select({ n: sql<string>`count(*)` })
        .from(clients)
        .innerJoin(shops, eq(shops.id, clients.shopId))
        .where(where);
      return num(totals?.n);
    },
  );

  return {
    ...result,
    rows: result.rows.map((r) => ({
      ...r,
      orderCount: num(r.orderCount),
      spentCents: num(r.spentCents),
      lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt) : null,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/*  Staff log                                                                  */
/* -------------------------------------------------------------------------- */
