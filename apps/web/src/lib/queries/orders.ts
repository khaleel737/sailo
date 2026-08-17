import "server-only";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, orders, type Client, type Order } from "@sailo/db/schema";
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
};

export function hasOrderFilters(filters: OrderFilters): boolean {
  return Object.values(filters).some(Boolean);
}

export async function getShopOrders(
  shopId: string,
  limit = 100,
  filters: OrderFilters = {},
) {
  return getDb().query.orders.findMany({
    where: and(
      eq(orders.shopId, shopId),
      ...(filters.status ? [eq(orders.status, filters.status)] : []),
      ...(filters.paymentMethod
        ? [eq(orders.paymentMethod, filters.paymentMethod)]
        : []),
      ...(filters.paymentStatus
        ? [eq(orders.paymentStatus, filters.paymentStatus)]
        : []),
      /*
       * Read from the order's snapshot rather than joined through
       * `couponId`. The snapshot is what the buyer was actually charged
       * under, and it survives the coupon being renamed or deleted — a join
       * would quietly stop finding last year's orders the day a seller tidies
       * up their codes.
       */
      ...(filters.couponCode
        ? [eq(orders.couponCode, filters.couponCode.toUpperCase())]
        : []),
    ),
    orderBy: [desc(orders.createdAt)],
    limit,
  });
}

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
