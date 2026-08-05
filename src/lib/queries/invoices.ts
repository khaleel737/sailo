import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { invoices, orders, shops } from "@/db/schema";
import { getOrderItems } from "./orders";

/** Invoices, by token for the buyer and by order for the seller. */

/** Public lookup by token — returns everything the invoice page renders. */
export async function getInvoiceByToken(token: string) {
  const db = getDb();

  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.token, token),
  });
  if (!invoice) return null;

  const [order, shop] = await Promise.all([
    db.query.orders.findFirst({ where: eq(orders.id, invoice.orderId) }),
    db.query.shops.findFirst({ where: eq(shops.id, invoice.shopId) }),
  ]);
  if (!order || !shop) return null;

  return { invoice, order, shop, items: await getOrderItems(order) };
}

export async function getInvoiceForOrder(orderId: string) {
  return getDb().query.invoices.findFirst({
    where: eq(invoices.orderId, orderId),
  });
}

/** Invoice numbers keyed by order id, for listing screens. */
export async function getInvoiceMap(orderIds: string[]) {
  const map = new Map<string, { number: string; token: string }>();
  if (orderIds.length === 0) return map;

  const rows = await getDb()
    .select({
      orderId: invoices.orderId,
      number: invoices.number,
      token: invoices.token,
    })
    .from(invoices)
    .where(inArray(invoices.orderId, orderIds));

  for (const r of rows) map.set(r.orderId, { number: r.number, token: r.token });
  return map;
}
