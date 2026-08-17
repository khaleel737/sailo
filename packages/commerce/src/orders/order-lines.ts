import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orderItems, type Order, type OrderItem } from "@sailo/db/schema";
import { linesFor, type OrderLine } from "@sailo/core/order-lines";

/**
 * Reading what an order contains.
 *
 * The half of `@sailo/core/order-lines` that needs a connection — its header
 * explains why the two are apart. `linesFor` is the rule about which of the
 * order's two representations to believe, and it stays there so that everything
 * which renders a line agrees with everything that reads one.
 */

/** Every line on one order, in the order the buyer added them. */
export async function orderLines(order: Order): Promise<OrderLine[]> {
  const items = await getDb().query.orderItems.findMany({
    where: eq(orderItems.orderId, order.id),
    orderBy: [asc(orderItems.position)],
  });
  return linesFor(order, items);
}

/** The same, for a list — one query rather than one per order. */
export async function orderLinesMap(
  orders: Order[],
): Promise<Map<string, OrderLine[]>> {
  const map = new Map<string, OrderLine[]>();
  if (orders.length === 0) return map;

  const items = await getDb().query.orderItems.findMany({
    where: inArray(
      orderItems.orderId,
      orders.map((o) => o.id),
    ),
    orderBy: [asc(orderItems.position)],
  });

  const byOrder = new Map<string, OrderItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.orderId) ?? [];
    list.push(item);
    byOrder.set(item.orderId, list);
  }

  for (const order of orders) {
    map.set(order.id, linesFor(order, byOrder.get(order.id) ?? []));
  }
  return map;
}
