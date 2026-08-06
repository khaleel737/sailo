import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { clients, orders, type Client, type Order } from "@/db/schema";
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
