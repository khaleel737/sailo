/**
 * Merging the two halves of the per-product table.
 *
 * Views come from `visits` (keyed by product id), sales from `order_items`
 * joined through `orders` (keyed by product id where the product still
 * exists, by its snapshotted title where it doesn't — deletion nulls the id
 * but history is real and stays on the page). Pure so the arithmetic —
 * especially conversion's divide-by-zero edge — is testable without a
 * database.
 */

export type PerformanceViews = {
  productId: string;
  title: string;
  views: number;
};

export type PerformanceSales = {
  /** Group key: the product id, or a derived key for deleted products. */
  key: string;
  productId: string | null;
  /** From the order-line snapshot, so a rename doesn't rewrite history. */
  title: string;
  orders: number;
  units: number;
  revenueCents: number;
};

export type PerformanceRow = {
  key: string;
  productId: string | null;
  title: string;
  views: number;
  orders: number;
  units: number;
  revenueCents: number;
  /** Orders per view, or null when there were no views — "—", not Infinity. */
  conversion: number | null;
};

export function conversionRate(orders: number, views: number): number | null {
  if (views <= 0) return null;
  return orders / views;
}

/**
 * One row per product, sales and views joined, sorted by revenue then views.
 *
 * A product with views and no orders still earns a row (the seller reads that
 * as "traffic that isn't converting"), as does one with orders and no views
 * (sold before the window opened, or a deleted product whose pageviews went
 * with it).
 */
export function mergePerformance(
  views: PerformanceViews[],
  sales: PerformanceSales[],
): PerformanceRow[] {
  const rows = new Map<string, PerformanceRow>();

  for (const sale of sales) {
    rows.set(sale.key, {
      key: sale.key,
      productId: sale.productId,
      title: sale.title,
      views: 0,
      orders: sale.orders,
      units: sale.units,
      revenueCents: sale.revenueCents,
      conversion: null,
    });
  }

  for (const view of views) {
    const row = rows.get(view.productId);
    if (row) {
      row.views = view.views;
    } else {
      rows.set(view.productId, {
        key: view.productId,
        productId: view.productId,
        title: view.title,
        views: view.views,
        orders: 0,
        units: 0,
        revenueCents: 0,
        conversion: null,
      });
    }
  }

  const merged = [...rows.values()];
  for (const row of merged) {
    row.conversion = conversionRate(row.orders, row.views);
  }

  merged.sort(
    (a, b) =>
      b.revenueCents - a.revenueCents ||
      b.views - a.views ||
      a.title.localeCompare(b.title),
  );
  return merged;
}
