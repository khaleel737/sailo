import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, type Order } from "@sailo/db/schema";
import { orderLines, orderLinesMap } from "@/lib/order-lines";

/** Orders and the people who placed them. */

/**
 * An order's lines. Delegates to `order-lines`, which is the only module
 * allowed to decide what an order contains — see the note there on why the
 * header columns are not a second source of truth.
 */
export async function getOrderItems(order: Order) {
  return orderLines(order);
}

/** The same, for a list of orders, in one query rather than one each. */
export async function getOrderItemsMap(rows: Order[]) {
  return orderLinesMap(rows);
}

/**
 * What the orders list may be narrowed by.
 *
 * Every one of these is a WHERE clause and none of them is a filter over the
 * rows that came back. The list has a ceiling, so filtering afterwards would
 * search the most recent hundred orders and present the result as "every
 * order paid with SUMMER20" — an answer with a silent truncation inside it,
 * which is worse than no filter at all.
 */
export type OrderFilters = {
  status?: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  /** Matched case-insensitively; coupon codes are stored uppercase. */
  couponCode?: string | null;
  /** Free text over buyer name, email and the headline product. */
  search?: string | null;
};

export function hasOrderFilters(filters: OrderFilters): boolean {
  return Object.values(filters).some(Boolean);
}

export {
  getShopOrder,
  getShopOrders,
  getShopOrderStatusCounts,
} from "@sailo/commerce/shop-views";

/** Every coupon code that has actually been used, for the filter's options. */
export async function usedCouponCodes(shopId: string): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ code: orders.couponCode })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), isNotNull(orders.couponCode)))
    .orderBy(orders.couponCode);

  return rows.map((r) => r.code).filter((c): c is string => Boolean(c));
}


/* -------------------------------------------------------------------------- */
/*  Payment methods                                                            */
/* -------------------------------------------------------------------------- */
