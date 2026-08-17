import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getReadDb } from "@sailo/db";
import {
  orderItems,
  orders,
  products,
  visits,
} from "@sailo/db/schema";
import {
  mergePerformance,
  type PerformanceSales,
  type PerformanceViews,
} from "./product-performance";
import { inWindow, windowBounds } from "./bounds";
import type { Window } from "./bounds";

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
