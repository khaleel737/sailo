import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, orders, type Client } from "@sailo/db/schema";
import { orderLinesMap } from "@sailo/commerce/order-lines";

/**
 * Reading a shop's customer list.
 *
 * This was in `apps/web/src/lib/queries/orders.ts`, beside the order reads,
 * because a customer's value is computed from their orders. It came here
 * because the thing that asks for it is not an orders screen — it is the
 * broadcast composer picking an audience, and that now lives in
 * `@sailo/marketing`, which cannot reach into the app.
 *
 * The tag filter stays a WHERE and never a filter over the rows that came back:
 * filtering after the ceiling would search only the most recent thousand
 * customers and call the result "everyone tagged vip", which is a silent
 * truncation that reads as an answer.
 */

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
