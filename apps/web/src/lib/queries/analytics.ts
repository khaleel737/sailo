import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { getReadDb } from "@/db";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  clicks,
  orderItems,
  orders,
  products,
  reviews,
  visitDaily,
  visits,
} from "@/db/schema";
import type { DateWindow } from "@/lib/analytics-window";
import {
  mergePerformance,
  type PerformanceSales,
  type PerformanceViews,
} from "@/lib/product-performance";

/**
 * Dashboard figures: what sold, who visited, and where they came from.
 *
 * Every read here goes to the replica. These are the widest scans in the
 * codebase — a window of visits and orders, grouped — they run on request
 * rather than from cache, and nothing in them decides whether a write
 * happens. A seller seeing a count that is a second old is not a bug; a
 * checkout slowed down by someone else's dashboard is.
 */

/**
 * Every read here accepts either shape: a day-count is the rolling window the
 * presets have always been, an explicit `{since, until}` is a custom range.
 * Passing a number produces byte-for-byte the query it produced before custom
 * ranges existed — no caller changed meaning.
 */
type Window = number | DateWindow;

/** The window as bounds. `until` stays null on the rolling path. */
function windowBounds(window: Window): { since: Date; until: Date | null } {
  if (typeof window === "number") {
    return {
      since: new Date(Date.now() - window * 24 * 60 * 60 * 1000),
      until: null,
    };
  }
  return window;
}

/** `col >= since`, plus `col < until` when the window has a far edge. */
function inWindow(
  column: AnyPgColumn,
  since: Date,
  until: Date | null,
) {
  return until
    ? and(gte(column, since), lt(column, until))
    : gte(column, since);
}

export async function getDashboardStats(shopId: string, window: Window = 30) {
  const db = getReadDb();
  const { since, until } = windowBounds(window);

  const [[visitRow], [periodRow], [openRow], [productRow], [reviewRow]] =
    await Promise.all([
      db
        .select({
          total: sql<string>`count(*)`,
          unique: sql<string>`count(distinct ${visits.sessionId})`,
        })
        .from(visits)
        .where(
          and(eq(visits.shopId, shopId), inWindow(visits.createdAt, since, until)),
        ),
      /*
       * What happened in the window the seller is looking at.
       *
       * This had no date bound at all, so a shop with two hundred lifetime
       * orders read "Last 30 days · Orders 200" in a month it had sold nothing
       * — four figures under one heading, two of them measuring a different
       * period from the other two. It also meant the app's home page
       * aggregated a shop's entire order history on every single load.
       */
      db
        .select({
          total: sql<string>`count(*)`,
          // Cancelled orders never counted; refunds come straight off the top.
          gross: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
          refunded: sql<string>`coalesce(sum(${orders.refundedCents}), 0)`,
          refundCount: sql<string>`count(*) filter (where ${orders.refundedCents} > 0)`,
          paid: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${orders.paymentStatus} = 'paid'), 0)`,
          // Tax the seller has collected and owes on. Cancelled orders never
          // happened; a refund hands the tax back with the rest of the money.
          tax: sql<string>`coalesce(sum(${orders.taxCents}) filter (where ${orders.status} <> 'cancelled' and ${orders.refundedCents} = 0), 0)`,
        })
        .from(orders)
        .where(
          and(eq(orders.shopId, shopId), inWindow(orders.createdAt, since, until)),
        ),
      /*
       * What still needs doing, whenever it happened.
       *
       * Deliberately not windowed. An order placed in March that has still not
       * shipped is exactly the one a seller must be told about, and bounding
       * this to thirty days would quietly hide it. Narrowed by state instead,
       * so it reads the open tail rather than every order ever placed.
       */
      db
        .select({
          pending: sql<string>`count(*) filter (where ${orders.status} = 'new')`,
          awaitingConfirm: sql<string>`count(*) filter (where ${orders.paymentStatus} = 'pending')`,
          awaitingShipment: sql<string>`count(*) filter (where ${orders.deliveryMethod} = 'shipping' and ${orders.status} in ('new','confirmed'))`,
          unpaidCommission: sql<string>`coalesce(sum(${orders.commissionCents}) filter (where not ${orders.commissionPaid}), 0)`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.shopId, shopId),
            or(
              inArray(orders.status, ["new", "confirmed"]),
              eq(orders.paymentStatus, "pending"),
              eq(orders.commissionPaid, false),
            ),
          ),
        ),
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
    totalOrders: Number(periodRow?.total ?? 0),
    newOrders: Number(openRow?.pending ?? 0),
    grossCents: Number(periodRow?.gross ?? 0),
    refundedCents: Number(periodRow?.refunded ?? 0),
    netRevenueCents:
      Number(periodRow?.gross ?? 0) - Number(periodRow?.refunded ?? 0),
    refundCount: Number(periodRow?.refundCount ?? 0),
    paidValueCents: Number(periodRow?.paid ?? 0),
    awaitingConfirmation: Number(openRow?.awaitingConfirm ?? 0),
    awaitingShipment: Number(openRow?.awaitingShipment ?? 0),
    unpaidCommissionCents: Number(openRow?.unpaidCommission ?? 0),
    taxCollectedCents: Number(periodRow?.tax ?? 0),
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

/**
 * Zero-fill keys and bounds for either window shape. A custom window's bounds
 * are already UTC midnights (the resolver made them), so stepping in whole
 * days lands exactly on its edge.
 */
function seriesWindow(window: Window): {
  since: Date;
  until: Date | null;
  keys: string[];
} {
  if (typeof window === "number") {
    return { ...utcDayWindow(window), until: null };
  }
  const keys: string[] = [];
  for (
    let t = window.since.getTime();
    t < window.until.getTime();
    t += 24 * 60 * 60 * 1000
  ) {
    keys.push(new Date(t).toISOString().slice(0, 10));
  }
  return { since: window.since, until: window.until, keys };
}

/**
 * Daily traffic for the last N days, zero-filled for the chart.
 *
 * Two figures per day: every view, and how many distinct sessions produced
 * them. The gap between the two is repeat viewing, which is the number a
 * seller reads to tell a link that is working from a link being refreshed.
 * Both come from the rollup, which already counts uniques per day — they can't
 * be summed across days without double-counting a returning visitor, which is
 * why the window total is still read separately.
 */
export async function getVisitSeries(shopId: string, window: Window = 14) {
  const { since, until, keys } = seriesWindow(window);
  const db = getReadDb();

  /*
   * Read the rollup first, then today from the raw table.
   *
   * Yesterday and earlier are already folded into one row per day, so a chart
   * over a year reads 365 rows instead of a year of pageviews. Today isn't
   * folded yet — the fold runs overnight — so it still comes from raw, which
   * is a single day of one shop's rows and cheap. Any day the rollup is
   * missing falls through to raw as well, so a skipped night shows real
   * numbers rather than a hole.
   */
  const [rolled, raw] = await Promise.all([
    db
      .select({
        day: sql<string>`to_char(${visitDaily.day}, 'YYYY-MM-DD')`,
        count: visitDaily.visits,
        unique: visitDaily.uniqueVisitors,
      })
      .from(visitDaily)
      .where(
        and(
          eq(visitDaily.shopId, shopId),
          inWindow(visitDaily.day, since, until),
        ),
      ),
    db
      .select({
        day: sql<string>`to_char(${visits.createdAt}::date, 'YYYY-MM-DD')`,
        count: sql<string>`count(*)`,
        unique: sql<string>`count(distinct ${visits.sessionId})`,
      })
      .from(visits)
      .where(
        and(eq(visits.shopId, shopId), inWindow(visits.createdAt, since, until)),
      )
      .groupBy(sql`${visits.createdAt}::date`),
  ]);

  const byDay = new Map(
    rolled.map((r) => [
      r.day,
      { count: Number(r.count), unique: Number(r.unique) },
    ]),
  );
  for (const r of raw) {
    // Raw wins only where the rollup hasn't been there — never added to it,
    // or a folded day whose raw rows are still inside retention doubles.
    if (!byDay.has(r.day)) {
      byDay.set(r.day, { count: Number(r.count), unique: Number(r.unique) });
    }
  }

  return keys.map((day) => ({
    day,
    count: byDay.get(day)?.count ?? 0,
    unique: byDay.get(day)?.unique ?? 0,
  }));
}

/**
 * Daily sales, refunds and the net of the two, zero-filled.
 *
 * Sales and refunds are counted on different days on purpose, because they
 * happen on different days. The previous version subtracted a refund from the
 * day the *order* was placed, so refunding a three-week-old order silently
 * rewrote a bar three weeks back and a seller watching the chart saw history
 * change. A refund is money leaving on the day it leaves.
 *
 * That also fixes an arithmetic fault the old shape hid. It subtracted every
 * refund while only adding non-cancelled sales, so an order that was cancelled
 * *and* refunded took its money out of a day that had never counted it in —
 * pushing the day negative for no reason a seller could see.
 */
export async function getRevenueSeries(shopId: string, window: Window = 14) {
  const { since, until, keys } = seriesWindow(window);
  const db = getReadDb();

  const [sales, refunds] = await Promise.all([
    db
      .select({
        day: sql<string>`to_char(${orders.createdAt}::date, 'YYYY-MM-DD')`,
        cents: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
      })
      .from(orders)
      .where(
        and(eq(orders.shopId, shopId), inWindow(orders.createdAt, since, until)),
      )
      .groupBy(sql`${orders.createdAt}::date`),
    db
      .select({
        day: sql<string>`to_char(${orders.refundedAt}::date, 'YYYY-MM-DD')`,
        cents: sql<string>`coalesce(sum(${orders.refundedCents}), 0)`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.shopId, shopId),
          isNotNull(orders.refundedAt),
          inWindow(orders.refundedAt, since, until),
        ),
      )
      .groupBy(sql`${orders.refundedAt}::date`),
  ]);

  const salesByDay = new Map(sales.map((r) => [r.day, Number(r.cents)]));
  const refundsByDay = new Map(refunds.map((r) => [r.day, Number(r.cents)]));

  return keys.map((day) => {
    const gross = salesByDay.get(day) ?? 0;
    // Held positive — it is an amount refunded, not a negative sale. The chart
    // decides which side of the axis it belongs on.
    const refunded = refundsByDay.get(day) ?? 0;
    return {
      day,
      cents: gross - refunded,
      grossCents: gross,
      refundedCents: refunded,
    };
  });
}

/**
 * Where a shop's visitors come from, over the same window as the charts.
 *
 * One pass over the visits table per dimension. Each is `count(*)` grouped and
 * ordered, capped at a handful of rows — a seller acts on the top few and a
 * long tail of one-visit referrers is noise.
 */
export async function getVisitBreakdown(
  shopId: string,
  window: Window = 30,
  limit = 6,
) {
  const db = getReadDb();
  const { since, until } = windowBounds(window);
  const scope = and(
    eq(visits.shopId, shopId),
    inWindow(visits.createdAt, since, until),
  );

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

  const rows = <R extends { key: string; count: string; unique: string }>(
    list: R[],
  ) =>
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
 * Where visitors went next — outbound click hosts, over the same window as
 * the sources panel it renders beside.
 *
 * Reads the raw `clicks` table for the whole window: clicks are an order of
 * magnitude rarer than visits and the table is not trimmed, so the read is
 * both cheap and complete. The nightly rollup still folds a `destinations`
 * dimension into `visit_daily` so the day this table ever needs a retention
 * window, the history is already somewhere the charts can reach.
 */
export async function getClickBreakdown(
  shopId: string,
  window: Window = 30,
  limit = 6,
) {
  const db = getReadDb();
  const { since, until } = windowBounds(window);
  const scope = and(
    eq(clicks.shopId, shopId),
    inWindow(clicks.createdAt, since, until),
  );

  const [hosts, totals] = await Promise.all([
    db
      .select({
        key: clicks.targetHost,
        count: sql<string>`count(*)`,
        unique: sql<string>`count(distinct ${clicks.sessionId})`,
      })
      .from(clicks)
      .where(scope)
      .groupBy(clicks.targetHost)
      .orderBy(desc(sql`count(*)`))
      .limit(limit),
    db
      .select({
        count: sql<string>`count(*)`,
        unique: sql<string>`count(distinct ${clicks.sessionId})`,
      })
      .from(clicks)
      .where(scope),
  ]);

  return {
    total: Number(totals[0]?.count ?? 0),
    unique: Number(totals[0]?.unique ?? 0),
    hosts: hosts.map((r) => ({
      key: r.key,
      count: Number(r.count),
      unique: Number(r.unique),
    })),
  };
}

export type ClickBreakdown = Awaited<ReturnType<typeof getClickBreakdown>>;

/** The table never renders more than a page of this at once. */
export const PERFORMANCE_PAGE_SIZE = 50;

/**
 * The per-product table: views, orders, conversion and revenue per product.
 *
 * Nothing new is written for this — `visits.productId` already records
 * product-page views, and the order lines carry per-product sales. Two
 * grouped reads, merged in `mergePerformance`.
 *
 * Sales come keyed by product id where the product still exists and by the
 * snapshotted line title where it doesn't: deletion nulls the id, and one
 * null group would otherwise fold every deleted product into a single row.
 * Titles always come from the order-line snapshot, so a renamed product's
 * history keeps saying what it said — only a product that sold nothing in the
 * window shows its current title, because a snapshot is the one thing it
 * doesn't have.
 *
 * The settled-filter is the dashboard's own — `status <> 'cancelled'`, the
 * same predicate `getDashboardStats` and `getRevenueSeries` count revenue
 * with — so this table and the revenue tile can never disagree about which
 * orders count.
 */
export async function getProductPerformance(
  shopId: string,
  window: Window = 30,
  page = 1,
) {
  const db = getReadDb();
  const { since, until } = windowBounds(window);

  const [viewRows, saleRows] = await Promise.all([
    // Runs against the partitioned table; the createdAt bound is what lets
    // the planner prune months (verified in scripts/check-load.ts).
    db
      .select({
        productId: visits.productId,
        views: sql<string>`count(*)`,
      })
      .from(visits)
      .where(
        and(
          eq(visits.shopId, shopId),
          inWindow(visits.createdAt, since, until),
          isNotNull(visits.productId),
        ),
      )
      .groupBy(visits.productId),
    db
      .select({
        key: sql<string>`coalesce(${orderItems.productId}::text, 'gone:' || ${orderItems.title})`,
        productId: sql<string | null>`max(${orderItems.productId}::text)`,
        title: sql<string>`max(${orderItems.title})`,
        orders: sql<string>`count(distinct ${orderItems.orderId})`,
        units: sql<string>`coalesce(sum(${orderItems.quantity}), 0)`,
        revenueCents: sql<string>`coalesce(sum(${orderItems.subtotalCents}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.shopId, shopId),
          inWindow(orders.createdAt, since, until),
          ne(orders.status, "cancelled"),
        ),
      )
      .groupBy(
        sql`coalesce(${orderItems.productId}::text, 'gone:' || ${orderItems.title})`,
      ),
  ]);

  const sales: PerformanceSales[] = saleRows.map((r) => ({
    key: r.key,
    productId: r.productId,
    title: r.title,
    orders: Number(r.orders),
    units: Number(r.units),
    revenueCents: Number(r.revenueCents),
  }));

  /*
   * Titles for products that were viewed but sold nothing in the window — the
   * one case with no order-line snapshot to read. The lookup can't miss:
   * deleting a product cascades its visits away, so a viewed id is a live row.
   */
  const soldKeys = new Set(sales.map((s) => s.key));
  const viewedOnly = viewRows
    .map((r) => r.productId)
    .filter((id): id is string => id !== null && !soldKeys.has(id));

  const titles = new Map<string, string>();
  if (viewedOnly.length > 0) {
    const rows = await db
      .select({ id: products.id, title: products.title })
      .from(products)
      .where(inArray(products.id, viewedOnly));
    for (const row of rows) titles.set(row.id, row.title);
  }

  const views: PerformanceViews[] = viewRows
    .filter((r): r is typeof r & { productId: string } => r.productId !== null)
    .map((r) => ({
      productId: r.productId,
      title: titles.get(r.productId) ?? "—",
      views: Number(r.views),
    }));

  const merged = mergePerformance(views, sales);

  // Paged, never silently capped: the caller shows "top N of total".
  const safePage = Math.max(1, Math.floor(page) || 1);
  const start = (safePage - 1) * PERFORMANCE_PAGE_SIZE;

  return {
    rows: merged.slice(start, start + PERFORMANCE_PAGE_SIZE),
    total: merged.length,
    page: safePage,
    perPage: PERFORMANCE_PAGE_SIZE,
  };
}

export type ProductPerformance = Awaited<
  ReturnType<typeof getProductPerformance>
>;
