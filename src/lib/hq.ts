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
  isNull,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import {
  affiliates,
  clients,
  coupons,
  invoices,
  orders,
  paymentMethods,
  products,
  reviews,
  shops,
  staffActions,
  stripeEvents,
  user,
  visitDaily,
  visits,
  type Shop,
} from "@/db/schema";
import {
  getDashboardStats,
  getRevenueSeries,
  getShopAffiliates,
  getShopClients,
  getShopCoupons,
  getShopDeliveryMethods,
  getShopOrders,
  getShopPaymentMethods,
  getVisitSeries,
} from "@/lib/queries";
import {
  mergeCurrencyTotals,
  rollUpRevenue,
  type BillingGroup,
  type BillingState,
  type CurrencyTotal,
} from "@/lib/hq-metrics";

/* ===========================================================================
   Platform-wide reads, for /hq.

   Everything in `lib/queries.ts` is scoped to one shop, because that is the
   only thing a seller may ever see. Nothing here is: these read across every
   account at once, which is exactly why they live in their own module and why
   every caller sits behind `requireStaff()`.

   Money is never summed across currencies. Sellers price in their own, so a
   platform total is a list of totals — see `mergeCurrencyTotals`.
=========================================================================== */

export const HQ_PAGE_SIZE = 25;

const DAY_MS = 24 * 60 * 60 * 1000;

const num = (value: unknown) => Number(value ?? 0);

const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

/**
 * A search param, as a single string.
 *
 * `?state=paying&state=free` is legal and arrives as an array; taking the
 * first is the same thing every browser form would have sent.
 */
export function first(
  value: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ? raw : undefined;
}

/** A positive page number from a query string, defaulting to the first. */
export function pageNumber(value: string | string[] | undefined): number {
  const parsed = Number(first(value));
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

/**
 * One page of a list, with its total.
 *
 * The page and the count go out together, because one waiting on the other
 * doubles the latency of every list in the panel for no reason. The re-read
 * only happens when the requested page is past the end — a stale bookmark, or
 * a filter change that shrank the results — and showing the last page beats an
 * empty table under a heading that says there are 200 rows.
 */
async function paginate<Row>(
  requested: number,
  fetchPage: (offset: number) => Promise<Row[]>,
  countAll: () => Promise<number>,
) {
  const page = Math.max(1, Math.floor(requested || 1));

  const [rows, total] = await Promise.all([
    fetchPage((page - 1) * HQ_PAGE_SIZE),
    countAll(),
  ]);

  const pages = Math.max(1, Math.ceil(total / HQ_PAGE_SIZE));
  if (page <= pages) return { rows, total, page, pages };

  return {
    rows: await fetchPage((pages - 1) * HQ_PAGE_SIZE),
    total,
    page: pages,
    pages,
  };
}

/** Escapes the wildcards so a search for "50%" doesn't match everything. */
function like(term: string) {
  return `%${term.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The UTC day buckets a chart is drawn over. Timestamps are stored as UTC and
 * Postgres `::date` truncates in UTC, so building these in local time silently
 * drops today's bucket for anyone ahead of Greenwich.
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

/* -------------------------------------------------------------------------- */
/*  Billing state, expressed as a query                                        */
/* -------------------------------------------------------------------------- */

const ENTITLED = ["active", "trialing", "past_due"];

/**
 * The SQL twin of `billingState()` in hq-metrics.
 *
 * Deliberately duplicated rather than filtered in JavaScript: the accounts list
 * is paginated, and a filter applied after the page is fetched would return
 * three rows on a page that promised twenty-five. The two must be changed
 * together — that is the cost of paging in the database.
 */
function stateFilter(state: BillingState): SQL | undefined {
  const uncomped = isNull(shops.compPlan);
  const paid = and(uncomped, ne(shops.plan, "free"));

  switch (state) {
    case "comped":
      return isNotNull(shops.compPlan);
    case "free":
      return and(
        uncomped,
        or(eq(shops.plan, "free"), isNull(shops.subscriptionStatus)),
      );
    case "paying":
      return and(paid, eq(shops.subscriptionStatus, "active"));
    case "trialing":
      return and(paid, eq(shops.subscriptionStatus, "trialing"));
    case "past_due":
      return and(paid, eq(shops.subscriptionStatus, "past_due"));
    case "canceled":
      return and(
        paid,
        isNotNull(shops.subscriptionStatus),
        notInArray(shops.subscriptionStatus, ENTITLED),
      );
  }
}

/* -------------------------------------------------------------------------- */
/*  Overview                                                                   */
/* -------------------------------------------------------------------------- */

export type PlatformOverview = Awaited<ReturnType<typeof getPlatformOverview>>;

export async function getPlatformOverview() {
  const db = getDb();

  const day = daysAgo(1);
  const week = daysAgo(7);
  const twoWeeks = daysAgo(14);
  const month = daysAgo(30);
  const twoMonths = daysAgo(60);

  const [
    [signups],
    [shopCounts],
    [orderCounts],
    gmvRows,
    gmvMonthRows,
    billingGroups,
    [catalogue],
    [audience],
    [traffic],
  ] = await Promise.all([
    // Registrations, with the previous window alongside so the tiles can say
    // whether the number is going anywhere.
    db
      .select({
        total: sql<string>`count(*)`,
        day: sql<string>`count(*) filter (where ${user.createdAt} >= ${day})`,
        week: sql<string>`count(*) filter (where ${user.createdAt} >= ${week})`,
        month: sql<string>`count(*) filter (where ${user.createdAt} >= ${month})`,
        prevWeek: sql<string>`count(*) filter (where ${user.createdAt} >= ${twoWeeks} and ${user.createdAt} < ${week})`,
        prevMonth: sql<string>`count(*) filter (where ${user.createdAt} >= ${twoMonths} and ${user.createdAt} < ${month})`,
      })
      .from(user),

    db
      .select({
        total: sql<string>`count(*)`,
        live: sql<string>`count(*) filter (where ${shops.isPublished} and ${shops.suspendedAt} is null)`,
        unpublished: sql<string>`count(*) filter (where not ${shops.isPublished})`,
        suspended: sql<string>`count(*) filter (where ${shops.suspendedAt} is not null)`,
        newWeek: sql<string>`count(*) filter (where ${shops.createdAt} >= ${week})`,
        newMonth: sql<string>`count(*) filter (where ${shops.createdAt} >= ${month})`,
        connected: sql<string>`count(*) filter (where ${shops.stripeChargesEnabled})`,
        connectStarted: sql<string>`count(*) filter (where ${shops.stripeAccountId} is not null)`,
        affiliateShops: sql<string>`count(*) filter (where ${shops.affiliatesEnabled})`,
      })
      .from(shops),

    db
      .select({
        total: sql<string>`count(*)`,
        week: sql<string>`count(*) filter (where ${orders.createdAt} >= ${week})`,
        month: sql<string>`count(*) filter (where ${orders.createdAt} >= ${month})`,
        prevMonth: sql<string>`count(*) filter (where ${orders.createdAt} >= ${twoMonths} and ${orders.createdAt} < ${month})`,
        paid: sql<string>`count(*) filter (where ${orders.paymentStatus} = 'paid')`,
        awaiting: sql<string>`count(*) filter (where ${orders.status} = 'new')`,
        refunded: sql<string>`count(*) filter (where ${orders.refundedCents} > 0)`,
      })
      .from(orders),

    // Sellers price in their own currency, so volume is a list, not a number.
    db
      .select({
        currency: orders.currency,
        cents: sql<string>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
      })
      .from(orders)
      .groupBy(orders.currency),

    db
      .select({
        currency: orders.currency,
        cents: sql<string>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
      })
      .from(orders)
      .where(gte(orders.createdAt, month))
      .groupBy(orders.currency),

    /*
     * Subscriptions folded down to their distinct shapes. A dozen groups come
     * back whether the platform has five shops or fifty thousand, and
     * `rollUpRevenue` multiplies each by its count.
     */
    db
      .select({
        plan: shops.plan,
        subscriptionStatus: shops.subscriptionStatus,
        subscriptionInterval: shops.subscriptionInterval,
        compPlan: shops.compPlan,
        accounts: sql<string>`count(*)`,
      })
      .from(shops)
      .groupBy(
        shops.plan,
        shops.subscriptionStatus,
        shops.subscriptionInterval,
        shops.compPlan,
      ),

    db
      .select({
        products: sql<string>`count(*)`,
        published: sql<string>`count(*) filter (where ${products.isPublished})`,
        digital: sql<string>`count(*) filter (where ${products.kind} = 'digital')`,
        services: sql<string>`count(*) filter (where ${products.kind} = 'service')`,
      })
      .from(products),

    db
      .select({
        buyers: sql<string>`count(*)`,
        newMonth: sql<string>`count(*) filter (where ${clients.createdAt} >= ${month})`,
      })
      .from(clients),

    db
      .select({
        month: sql<string>`count(*) filter (where ${visits.createdAt} >= ${month})`,
        week: sql<string>`count(*) filter (where ${visits.createdAt} >= ${week})`,
      })
      .from(visits),
  ]);

  const revenue = rollUpRevenue(
    billingGroups.map(
      (row): BillingGroup => ({
        plan: row.plan,
        subscriptionStatus: row.subscriptionStatus,
        subscriptionInterval: row.subscriptionInterval,
        compPlan: row.compPlan,
        accounts: num(row.accounts),
      }),
    ),
  );

  const toTotals = (rows: { currency: string; cents: string }[]) =>
    mergeCurrencyTotals(
      rows.map((r): CurrencyTotal => ({ currency: r.currency, cents: num(r.cents) })),
    );

  return {
    revenue,
    accounts: {
      total: num(signups?.total),
      day: num(signups?.day),
      week: num(signups?.week),
      month: num(signups?.month),
      prevWeek: num(signups?.prevWeek),
      prevMonth: num(signups?.prevMonth),
    },
    shops: {
      total: num(shopCounts?.total),
      live: num(shopCounts?.live),
      unpublished: num(shopCounts?.unpublished),
      suspended: num(shopCounts?.suspended),
      newWeek: num(shopCounts?.newWeek),
      newMonth: num(shopCounts?.newMonth),
      connected: num(shopCounts?.connected),
      connectStarted: num(shopCounts?.connectStarted),
      affiliateShops: num(shopCounts?.affiliateShops),
    },
    orders: {
      total: num(orderCounts?.total),
      week: num(orderCounts?.week),
      month: num(orderCounts?.month),
      prevMonth: num(orderCounts?.prevMonth),
      paid: num(orderCounts?.paid),
      awaiting: num(orderCounts?.awaiting),
      refunded: num(orderCounts?.refunded),
    },
    gmv: toTotals(gmvRows),
    gmvMonth: toTotals(gmvMonthRows),
    catalogue: {
      products: num(catalogue?.products),
      published: num(catalogue?.published),
      digital: num(catalogue?.digital),
      services: num(catalogue?.services),
    },
    buyers: {
      total: num(audience?.buyers),
      month: num(audience?.newMonth),
    },
    visits: {
      month: num(traffic?.month),
      week: num(traffic?.week),
    },
  };
}

/**
 * How far accounts get, as counts at each step.
 *
 * Every step is measured against the same denominator — everyone who ever
 * registered — so the drop between two steps is readable straight off the
 * numbers rather than needing a per-step base.
 */
export async function getActivationFunnel() {
  const db = getDb();

  const [[users], [shopped], [stocked], [sold], [paid]] = await Promise.all([
    db.select({ n: sql<string>`count(*)` }).from(user),
    db
      .select({
        n: sql<string>`count(*)`,
        live: sql<string>`count(*) filter (where ${shops.isPublished} and ${shops.suspendedAt} is null)`,
      })
      .from(shops),
    db
      .select({ n: sql<string>`count(distinct ${products.shopId})` })
      .from(products),
    db.select({ n: sql<string>`count(distinct ${orders.shopId})` }).from(orders),
    db
      .select({ n: sql<string>`count(*)` })
      .from(shops)
      .where(
        or(
          and(
            isNull(shops.compPlan),
            ne(shops.plan, "free"),
            inArray(shops.subscriptionStatus, ENTITLED),
          ),
          isNotNull(shops.compPlan),
        ),
      ),
  ]);

  const registered = num(users?.n);

  return {
    registered,
    steps: [
      { key: "registered", label: "Registered", count: registered },
      { key: "shop", label: "Created a shop", count: num(shopped?.n) },
      { key: "live", label: "Shop is live", count: num(shopped?.live) },
      { key: "product", label: "Added a product", count: num(stocked?.n) },
      { key: "order", label: "Took an order", count: num(sold?.n) },
      { key: "paid", label: "On a paid plan", count: num(paid?.n) },
    ],
  };
}

/** Daily registrations, zero-filled so the chart has no holes. */
export async function getSignupSeries(days = 30) {
  const { since, keys } = utcDayWindow(days);

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${user.createdAt}::date, 'YYYY-MM-DD')`,
      count: sql<string>`count(*)`,
    })
    .from(user)
    .where(gte(user.createdAt, since))
    .groupBy(sql`${user.createdAt}::date`);

  const byDay = new Map(rows.map((r) => [r.day, num(r.count)]));
  return keys.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

/** Daily order count across every shop. Currency-free, so it always adds up. */
export async function getPlatformOrderSeries(days = 30) {
  const { since, keys } = utcDayWindow(days);

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${orders.createdAt}::date, 'YYYY-MM-DD')`,
      count: sql<string>`count(*)`,
    })
    .from(orders)
    .where(gte(orders.createdAt, since))
    .groupBy(sql`${orders.createdAt}::date`);

  const byDay = new Map(rows.map((r) => [r.day, num(r.count)]));
  return keys.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

/**
 * Daily volume in one currency.
 *
 * A single line can only honestly carry one currency, so the caller passes the
 * platform's biggest and the chart says which it is drawing.
 */
export async function getPlatformGmvSeries(currency: string, days = 30) {
  const { since, keys } = utcDayWindow(days);

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${orders.createdAt}::date, 'YYYY-MM-DD')`,
      cents: sql<string>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
    })
    .from(orders)
    .where(and(gte(orders.createdAt, since), eq(orders.currency, currency)))
    .groupBy(sql`${orders.createdAt}::date`);

  const byDay = new Map(rows.map((r) => [r.day, num(r.cents)]));
  return keys.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

/* -------------------------------------------------------------------------- */
/*  Accounts                                                                   */
/* -------------------------------------------------------------------------- */

export type AccountFilters = {
  q?: string;
  /** A billing state, or "all". */
  state?: string;
  /** onboarded | none | live | unpublished | suspended | connected */
  shopState?: string;
  sort?: string;
  page?: number;
};

export type AccountRow = {
  userId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  joinedAt: Date;
  shop: Shop | null;
  productCount: number;
  orderCount: number;
  gmvCents: number;
  lastOrderAt: Date | null;
};

/*
 * The per-shop aggregates, defined once and used twice — in the select list and
 * again in ORDER BY.
 *
 * Ordering by the output name would be legal Postgres and much tidier, but
 * Drizzle doesn't emit `AS "alias"`: it selects the bare expressions and maps
 * them back to keys in JavaScript. So the database never learns the name, and
 * `order by "gmvCents"` fails with "column does not exist".
 *
 * Note the outer column is written out — `shops.id`, not `${shops.id}`. Drizzle
 * only qualifies a column reference when the query has a join, so in a
 * single-table select the same interpolation renders as a bare `"id"`, which
 * inside the subquery resolves to the *inner* table's id. That doesn't error:
 * it quietly matches nothing and reports zero for everything. It shipped for
 * about an hour and was caught by a screenshot showing a product that had
 * clearly sold two of itself listed as having sold none.
 */
const PRODUCT_COUNT = sql<string>`(select count(*) from products p where p.shop_id = shops.id)`;
const ORDER_COUNT = sql<string>`(select count(*) from orders o where o.shop_id = shops.id)`;
const GMV_CENTS = sql<string>`(
  select coalesce(sum(o.total_cents - o.refunded_cents), 0)
  from orders o
  where o.shop_id = ${shops.id} and o.status <> 'cancelled'
)`;
const LAST_ORDER_AT = sql<
  string | null
>`(select max(o.created_at) from orders o where o.shop_id = shops.id)`;

const ACCOUNT_SORTS = {
  newest: desc(user.createdAt),
  oldest: asc(user.createdAt),
  gmv: desc(GMV_CENTS),
  orders: desc(ORDER_COUNT),
  products: desc(PRODUCT_COUNT),
  // Accounts that never sold anything belong at the bottom of "recently
  // active", not the top, which is where a null would sort by default.
  active: sql`${LAST_ORDER_AT} desc nulls last`,
} satisfies Record<string, SQL>;

function accountSort(key: string | undefined): SQL {
  return key && key in ACCOUNT_SORTS
    ? ACCOUNT_SORTS[key as keyof typeof ACCOUNT_SORTS]
    : ACCOUNT_SORTS.newest;
}

export const ACCOUNT_SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "gmv", label: "Highest volume" },
  { value: "orders", label: "Most orders" },
  { value: "products", label: "Most products" },
  { value: "active", label: "Recently active" },
] as const;

function accountWhere(filters: AccountFilters): SQL | undefined {
  const clauses: (SQL | undefined)[] = [];

  if (filters.q?.trim()) {
    const pattern = like(filters.q);
    clauses.push(
      or(
        ilike(user.name, pattern),
        ilike(user.email, pattern),
        ilike(shops.name, pattern),
        ilike(shops.handle, pattern),
      ),
    );
  }

  if (filters.state && filters.state !== "all") {
    clauses.push(stateFilter(filters.state as BillingState));
  }

  switch (filters.shopState) {
    case "onboarded":
      clauses.push(isNotNull(shops.id));
      break;
    case "none":
      clauses.push(isNull(shops.id));
      break;
    case "live":
      clauses.push(and(eq(shops.isPublished, true), isNull(shops.suspendedAt)));
      break;
    case "unpublished":
      clauses.push(eq(shops.isPublished, false));
      break;
    case "suspended":
      clauses.push(isNotNull(shops.suspendedAt));
      break;
    case "connected":
      clauses.push(eq(shops.stripeChargesEnabled, true));
      break;
    default:
      break;
  }

  const present = clauses.filter(Boolean);
  return present.length > 0 ? and(...present) : undefined;
}

/**
 * One page of accounts — every registered user, with the shop they own if they
 * ever finished onboarding, and the numbers that say whether it went anywhere.
 *
 * A left join, not an inner one: someone who signed up and never created a
 * shop is exactly the account we most need to see.
 */
export async function getAccounts(filters: AccountFilters = {}) {
  const db = getDb();
  const where = accountWhere(filters);

  const result = await paginate(
    filters.page ?? 1,
    (offset) =>
      db
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          joinedAt: user.createdAt,
          shop: shops,
          productCount: PRODUCT_COUNT,
          orderCount: ORDER_COUNT,
          gmvCents: GMV_CENTS,
          lastOrderAt: LAST_ORDER_AT,
        })
        .from(user)
        .leftJoin(shops, eq(shops.userId, user.id))
        .where(where)
        .orderBy(accountSort(filters.sort))
        .limit(HQ_PAGE_SIZE)
        .offset(offset),

    async () => {
      const [totals] = await db
        .select({ n: sql<string>`count(*)` })
        .from(user)
        .leftJoin(shops, eq(shops.userId, user.id))
        .where(where);
      return num(totals?.n);
    },
  );

  return {
    ...result,
    rows: result.rows.map(
      (r): AccountRow => ({
        userId: r.userId,
        name: r.name,
        email: r.email,
        emailVerified: r.emailVerified,
        joinedAt: r.joinedAt,
        shop: r.shop,
        productCount: num(r.productCount),
        orderCount: num(r.orderCount),
        gmvCents: num(r.gmvCents),
        lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt) : null,
      }),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/*  One account, in full                                                       */
/* -------------------------------------------------------------------------- */

export type AccountDetail = NonNullable<
  Awaited<ReturnType<typeof getAccountDetail>>
>;

export async function getAccountDetail(userId: string) {
  const db = getDb();

  const owner = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!owner) return null;

  const shop = await db.query.shops.findFirst({
    where: eq(shops.userId, owner.id),
  });

  // Someone who registered and stopped. There is still something to say about
  // them — when they arrived, and that they never got as far as a shop.
  if (!shop) {
    return {
      owner,
      shop: null,
      log: await getStaffLog({ limit: 20 }),
    } as const;
  }

  const [
    stats,
    recentOrders,
    catalogue,
    shopAffiliates,
    buyers,
    payments,
    delivery,
    shopCoupons,
    [extras],
    visitSeries,
    revenueSeries,
    log,
  ] = await Promise.all([
    getDashboardStats(shop.id, 30),
    getShopOrders(shop.id, 10),
    getShopProductRows(shop.id, 12),
    getShopAffiliates(shop.id),
    getShopClients(shop.id),
    getShopPaymentMethods(shop.id),
    getShopDeliveryMethods(shop.id),
    getShopCoupons(shop.id),
    db
      .select({
        invoices: sql<string>`(select count(*) from invoices i where i.shop_id = ${shop.id})`,
        reviews: sql<string>`(select count(*) from reviews r where r.shop_id = ${shop.id})`,
        categories: sql<string>`(select count(*) from categories c where c.shop_id = ${shop.id})`,
        firstOrderAt: sql<Date | null>`(select min(o.created_at) from orders o where o.shop_id = ${shop.id})`,
        lastOrderAt: sql<Date | null>`(select max(o.created_at) from orders o where o.shop_id = ${shop.id})`,
      })
      .from(shops)
      .where(eq(shops.id, shop.id)),
    getVisitSeries(shop.id, 30),
    getRevenueSeries(shop.id, 30),
    getStaffLog({ shopId: shop.id, limit: 20 }),
  ]);

  return {
    owner,
    shop,
    stats,
    recentOrders,
    catalogue,
    affiliates: shopAffiliates,
    buyers: buyers.slice(0, 8),
    buyerCount: buyers.length,
    payments,
    delivery,
    coupons: shopCoupons,
    invoiceCount: num(extras?.invoices),
    reviewCount: num(extras?.reviews),
    categoryCount: num(extras?.categories),
    firstOrderAt: extras?.firstOrderAt ? new Date(extras.firstOrderAt) : null,
    lastOrderAt: extras?.lastOrderAt ? new Date(extras.lastOrderAt) : null,
    visitSeries,
    revenueSeries,
    log,
  } as const;
}

export type ShopProductRow = {
  id: string;
  title: string;
  slug: string;
  kind: string;
  priceCents: number;
  isPublished: boolean;
  inStock: boolean;
  stockQuantity: number | null;
  createdAt: Date;
  orderCount: number;
};

/** A shop's catalogue, light — no images or variants, just what a table shows. */
async function getShopProductRows(shopId: string, limit = 12) {
  const rows = await getDb()
    .select({
      id: products.id,
      title: products.title,
      slug: products.slug,
      kind: products.kind,
      priceCents: products.priceCents,
      isPublished: products.isPublished,
      inStock: products.inStock,
      stockQuantity: products.stockQuantity,
      createdAt: products.createdAt,
      orderCount: sql<string>`(select count(*) from order_items oi where oi.product_id = products.id)`,
    })
    .from(products)
    .where(eq(products.shopId, shopId))
    .orderBy(desc(products.createdAt))
    .limit(limit);

  return rows.map(
    (r): ShopProductRow => ({ ...r, orderCount: num(r.orderCount) }),
  );
}

/* -------------------------------------------------------------------------- */
/*  Subscriptions                                                              */
/* -------------------------------------------------------------------------- */

export type SubscriptionRow = {
  shop: Shop;
  ownerName: string;
  ownerEmail: string;
};

/**
 * Every account that is paying us, trialling, failing to pay, or comped —
 * everything except the shops that have never been on a paid plan.
 */
export async function getPaidAccounts(): Promise<SubscriptionRow[]> {
  const rows = await getDb()
    .select({ shop: shops, ownerName: user.name, ownerEmail: user.email })
    .from(shops)
    .innerJoin(user, eq(user.id, shops.userId))
    .where(
      or(
        isNotNull(shops.compPlan),
        and(ne(shops.plan, "free"), isNotNull(shops.subscriptionStatus)),
      ),
    )
    .orderBy(desc(shops.currentPeriodEnd));

  return rows;
}

/** Subscriptions renewing inside the window — next month's expected billing. */
export function renewalsWithin(rows: SubscriptionRow[], days = 30) {
  const cutoff = new Date(Date.now() + days * DAY_MS);
  return rows
    .filter(
      (r) =>
        r.shop.currentPeriodEnd &&
        r.shop.currentPeriodEnd <= cutoff &&
        r.shop.currentPeriodEnd >= new Date() &&
        r.shop.subscriptionStatus === "active",
    )
    .toSorted(
      (a, b) =>
        (a.shop.currentPeriodEnd?.getTime() ?? 0) -
        (b.shop.currentPeriodEnd?.getTime() ?? 0),
    );
}

/** How sellers are taking money, across the platform. */
export async function getRailAdoption() {
  const rows = await getDb()
    .select({
      type: paymentMethods.type,
      shops: sql<string>`count(*)`,
      enabled: sql<string>`count(*) filter (where ${paymentMethods.isEnabled})`,
    })
    .from(paymentMethods)
    .groupBy(paymentMethods.type)
    .orderBy(sql`count(*) desc`);

  return rows.map((r) => ({
    type: r.type,
    shops: num(r.shops),
    enabled: num(r.enabled),
  }));
}

/* -------------------------------------------------------------------------- */
/*  Platform-wide lists                                                        */
/* -------------------------------------------------------------------------- */

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

export async function getStaffLog({
  shopId,
  limit = 40,
}: { shopId?: string; limit?: number } = {}) {
  return getDb()
    .select({
      id: staffActions.id,
      actorEmail: staffActions.actorEmail,
      action: staffActions.action,
      summary: staffActions.summary,
      createdAt: staffActions.createdAt,
      shopId: staffActions.shopId,
      shopName: shops.name,
      shopHandle: shops.handle,
      ownerId: shops.userId,
    })
    .from(staffActions)
    .leftJoin(shops, eq(shops.id, staffActions.shopId))
    .where(shopId ? eq(staffActions.shopId, shopId) : undefined)
    .orderBy(desc(staffActions.createdAt))
    .limit(limit);
}

/* -------------------------------------------------------------------------- */
/*  System                                                                     */
/* -------------------------------------------------------------------------- */

/** Reports only whether an environment variable is set — never its value. */
function flag(name: string, key: string, detail?: string) {
  return { name, ok: Boolean(process.env[key]), detail };
}

/**
 * What the platform is wired to, and whether the machinery ran.
 *
 * Only ever reports whether a secret is *present*. Nothing here prints a key,
 * a token or any part of one — this page is one leaked screenshot away from
 * being a very bad day.
 */
export async function getSystemHealth() {
  const db = getDb();

  const priceKeys = [
    "STRIPE_PRICE_PRO_MONTHLY",
    "STRIPE_PRICE_PRO_YEARLY",
    "STRIPE_PRICE_BUSINESS_MONTHLY",
    "STRIPE_PRICE_BUSINESS_YEARLY",
  ];
  const missingPrices = priceKeys.filter((key) => !process.env[key]);

  /*
   * One count per table, in parallel. A single query with ten scalar
   * subqueries would need a FROM to hang them off, and every candidate table
   * can be empty — which would return no row at all and report the whole
   * platform as zero.
   */
  const countOf = async (table: PgTable) => {
    const [row] = await db.select({ n: sql<string>`count(*)` }).from(table);
    return num(row?.n);
  };

  const [
    [rollup],
    [events],
    [lastEvent],
    users,
    shopCount,
    productCount,
    orderCount,
    clientCount,
    affiliateCount,
    invoiceCount,
    reviewCount,
    couponCount,
    visitCount,
  ] = await Promise.all([
    db
      .select({
        through: sql<string | null>`max(${visitDaily.day})`,
        rows: sql<string>`count(*)`,
      })
      .from(visitDaily),
    db.select({ n: sql<string>`count(*)` }).from(stripeEvents),
    db
      .select({
        type: stripeEvents.type,
        at: stripeEvents.processedAt,
      })
      .from(stripeEvents)
      .orderBy(desc(stripeEvents.processedAt))
      .limit(1),
    countOf(user),
    countOf(shops),
    countOf(products),
    countOf(orders),
    countOf(clients),
    countOf(affiliates),
    countOf(invoices),
    countOf(reviews),
    countOf(coupons),
    countOf(visits),
  ]);

  return {
    integrations: [
      flag("Database", "DATABASE_URL", "Neon Postgres"),
      flag("Auth secret", "BETTER_AUTH_SECRET"),
      flag("App URL", "NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL),
      flag("Stripe billing", "STRIPE_SECRET_KEY", "Subscriptions"),
      flag("Stripe webhook", "STRIPE_WEBHOOK_SECRET", "Plan changes land here"),
      flag(
        "Stripe Connect",
        "STRIPE_PLATFORM_ACCOUNT_ID",
        "Card payments for sellers",
      ),
      {
        name: "Plan prices",
        ok: missingPrices.length === 0,
        detail:
          missingPrices.length === 0
            ? "All four configured"
            : `Missing: ${missingPrices.join(", ")}`,
      },
      flag("Email", "RESEND_API_KEY", "Order and invoice mail"),
      flag("File storage", "BLOB_READ_WRITE_TOKEN", "Product images and files"),
      { name: "Redis", ok: Boolean(process.env.REDIS_URL), detail: "Optional — rate limiting" },
      flag("Cron secret", "CRON_SECRET", "Guards the nightly rollup"),
    ],
    tables: [
      { name: "Accounts", n: users },
      { name: "Shops", n: shopCount },
      { name: "Products", n: productCount },
      { name: "Orders", n: orderCount },
      { name: "Buyers", n: clientCount },
      { name: "Affiliates", n: affiliateCount },
      { name: "Invoices", n: invoiceCount },
      { name: "Reviews", n: reviewCount },
      { name: "Coupons", n: couponCount },
      { name: "Pageviews", n: visitCount },
    ],
    rollup: {
      through: rollup?.through ? new Date(rollup.through) : null,
      rows: num(rollup?.rows),
      /*
       * Whole days between the last folded day and now, worked out here rather
       * than in the page. A component that reads the clock renders differently
       * every time it is called, which React is right to object to.
       */
      daysBehind: rollup?.through
        ? Math.floor((Date.now() - new Date(rollup.through).getTime()) / DAY_MS)
        : null,
    },
    stripeEvents: {
      total: num(events?.n),
      lastType: lastEvent?.type ?? null,
      lastAt: lastEvent?.at ?? null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Exports                                                                    */
/* -------------------------------------------------------------------------- */

/** Rows for the CSV exports, unpaginated but bounded. */
export async function getAllAccountsForExport(limit = 5000) {
  const rows = await getDb()
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      joinedAt: user.createdAt,
      shop: shops,
      productCount: sql<string>`(select count(*) from products p where p.shop_id = shops.id)`,
      orderCount: sql<string>`(select count(*) from orders o where o.shop_id = shops.id)`,
      gmvCents: sql<string>`(select coalesce(sum(o.total_cents - o.refunded_cents), 0) from orders o where o.shop_id = shops.id and o.status <> 'cancelled')`,
    })
    .from(user)
    .leftJoin(shops, eq(shops.userId, user.id))
    .orderBy(desc(user.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    productCount: num(r.productCount),
    orderCount: num(r.orderCount),
    gmvCents: num(r.gmvCents),
  }));
}

export async function getAllOrdersForExport(limit = 10000) {
  return getDb()
    .select({
      order: orders,
      shopName: shops.name,
      shopHandle: shops.handle,
      ownerEmail: user.email,
    })
    .from(orders)
    .innerJoin(shops, eq(shops.id, orders.shopId))
    .innerJoin(user, eq(user.id, shops.userId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}

export async function getAllProductsForExport(limit = 10000) {
  return getDb()
    .select({
      product: products,
      shopName: shops.name,
      shopHandle: shops.handle,
      currency: shops.currency,
    })
    .from(products)
    .innerJoin(shops, eq(shops.id, products.shopId))
    .orderBy(desc(products.createdAt))
    .limit(limit);
}

export async function getAllAffiliatesForExport(limit = 10000) {
  const rows = await getDb()
    .select({
      affiliate: affiliates,
      shopHandle: shops.handle,
      currency: shops.currency,
      orderCount: sql<string>`(select count(*) from orders o where o.affiliate_id = affiliates.id)`,
      earnedCents: sql<string>`(select coalesce(sum(o.commission_cents), 0) from orders o where o.affiliate_id = affiliates.id)`,
      unpaidCents: sql<string>`(select coalesce(sum(o.commission_cents), 0) from orders o where o.affiliate_id = affiliates.id and not o.commission_paid)`,
    })
    .from(affiliates)
    .innerJoin(shops, eq(shops.id, affiliates.shopId))
    .orderBy(desc(affiliates.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    orderCount: num(r.orderCount),
    earnedCents: num(r.earnedCents),
    unpaidCents: num(r.unpaidCents),
  }));
}

export async function getAllBuyersForExport(limit = 10000) {
  const rows = await getDb()
    .select({
      client: clients,
      shopHandle: shops.handle,
      currency: shops.currency,
      orderCount: sql<string>`(select count(*) from orders o where o.client_id = clients.id)`,
      spentCents: sql<string>`(select coalesce(sum(o.total_cents - o.refunded_cents), 0) from orders o where o.client_id = clients.id and o.status <> 'cancelled')`,
    })
    .from(clients)
    .innerJoin(shops, eq(shops.id, clients.shopId))
    .orderBy(desc(clients.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    orderCount: num(r.orderCount),
    spentCents: num(r.spentCents),
  }));
}
