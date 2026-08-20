import "server-only";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
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

/**
 * The detail page's ↑↓ arrows — this order's neighbours under the list's own
 * ordering (`desc(createdAt)`, unfiltered). ↑ is the row above, which on a
 * newest-first list is the *newer* order. Ids only, capped at the same
 * hundred rows the list shows plus enough tail to keep the arrows honest at
 * the boundary.
 */
export async function adjacentOrderIds(
  shopId: string,
  orderId: string,
): Promise<{ prev: string | null; next: string | null }> {
  const rows = await getDb()
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.shopId, shopId))
    .orderBy(sql`${orders.createdAt} desc`)
    .limit(500);

  const at = rows.findIndex((row) => row.id === orderId);
  if (at === -1) return { prev: null, next: null };
  return {
    prev: rows[at - 1]?.id ?? null,
    next: rows[at + 1]?.id ?? null,
  };
}

/**
 * What settled over card in the last thirty days, net of refunds.
 *
 * One number with one reader: the plan cards, which turn the fee ladder into
 * this shop's own arithmetic — "on Business you'd have kept ~$X more". The
 * WHERE mirrors where the platform fee is actually charged: card orders that
 * were paid, with whatever was later refunded taken back out.
 */
export async function cardNetLast30Days(shopId: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await getDb()
    .select({
      cents: sql<number>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, shopId),
        eq(orders.paymentMethod, "card"),
        eq(orders.paymentStatus, "paid"),
        gte(orders.createdAt, since),
      ),
    );
  return rows[0]?.cents ?? 0;
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
