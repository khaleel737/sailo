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

export type ClientRow = Client & {
  orderCount: number;
  totalCents: number;
  lastOrderAt: Date | null;
};

/**
 * How many clients a screen asks for. An export asks for all of them.
 *
 * This aggregated every client against every order they had ever placed, with
 * no ceiling — so the shop with the most customers, which is the one paying
 * most, had the slowest admin and eventually one that would not finish.
 *
 * A thousand, not two hundred: a ceiling low enough for a real shop to reach
 * silently is worse than none, because the page renders what it got as the
 * whole list. This is a backstop, and the page says so when it is hit.
 */
export const CLIENT_LIMIT = 1_000;

/**
 * Clients with their lifetime totals, most recently active first.
 *
 * `limit: null` means every row and is only for the CSV export, where the
 * whole point is completeness and the caller has asked for a file. Every
 * screen passes a bound, and the default is bounded so a new screen inherits
 * the safe answer rather than the fast-to-write one.
 */
export async function getShopClients(
  shopId: string,
  limit: number | null = CLIENT_LIMIT,
  /**
   * One tag to narrow to, already normalised by the caller.
   *
   * Applied as a WHERE and not as a filter over the rows that came back.
   * Filtering after the ceiling would search only the most recent thousand
   * customers and call the result "everyone tagged vip" — a silent truncation
   * that reads as an answer.
   */
  tag?: string | null,
): Promise<ClientRow[]> {
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
    .where(
      and(
        eq(clients.shopId, shopId),
        // Array containment, which is what the GIN index in `drizzle/0012`
        // can answer. `= any(tags)` cannot use it.
        ...(tag ? [sql`${clients.tags} @> ARRAY[${tag}]::text[]`] : []),
      ),
    )
    .groupBy(clients.id)
    .orderBy(sql`max(${orders.createdAt}) desc nulls last`)
    .limit(limit ?? Number.MAX_SAFE_INTEGER);

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
