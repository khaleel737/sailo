"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { callerIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/redis";
import type { CheckoutOutcome } from "@/lib/orders/types";

/**
 * One question, asked by a storefront that sent a buyer to Stripe and never
 * saw them again: did that order settle?
 *
 * The basket is not emptied when a card order is created — the buyer has not
 * paid at that point and may never — so a storefront that finds a parked order
 * id on load asks here what became of it, and empties the basket only on
 * "settled".
 *
 * Public and unauthenticated, like the transfer-reference action: the caller
 * proves they know an order id, which is an unguessable UUID this same browser
 * was handed at checkout. The answer is one word about whether money moved —
 * no amounts, no items, no names — which is less than the invoice URL the
 * confirmation already gave them.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function checkoutOutcome(
  orderId: string,
): Promise<CheckoutOutcome> {
  // "pending" when refused: it changes nothing, so the next visit asks again.
  const gate = await rateLimit(`outcome:${await callerIp()}`, 30, 60);
  if (!gate.allowed) return "pending";

  // A marker that was never an id will never become an order.
  if (typeof orderId !== "string" || !UUID.test(orderId)) return "gone";

  const order = await getDb().query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { paymentStatus: true, status: true },
  });

  // Deleted when its Stripe session could not be created, or never existed.
  if (!order) return "gone";
  // The sweep reclaimed it — stock back, coupon back — so the basket may live.
  if (order.status === "cancelled") return "gone";
  // No webhook yet: the buyer may have Stripe open in another tab right now.
  if (order.paymentStatus === "unpaid") return "pending";
  // Paid, or a later state that implies it once was. The basket is spent.
  return "settled";
}
