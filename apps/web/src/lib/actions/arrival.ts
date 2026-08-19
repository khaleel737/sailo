"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders } from "@sailo/db/schema";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { confirmDelivery, readArrivalToken } from "@sailo/commerce/disputes";
import { revalidateShop } from "@/lib/cache";

/**
 * The buyer saying their parcel arrived.
 *
 * Spec 44's cheapest strong evidence. `product_not_received` — Visa 13.1,
 * Mastercard 4855 — turns entirely on delivery, and `docs/chargebacks.md` states
 * the rule: *"a tracking number showing 'in transit' is not delivery."* A
 * seller's own tick is weak; a carrier's proof of delivery needs an integration
 * nobody has built; **the cardholder's own timestamped confirmation is stronger
 * than either**, and it costs this file and one page.
 *
 * ## Why it is a POST behind a button
 *
 * The same reason unsubscribing is. Every URL in an email is fetched by
 * something that is not the recipient — spam scanners, link previewers,
 * corporate mail gateways — and a GET that recorded delivery would file evidence
 * with a card network on behalf of a buyer who never opened the message. That is
 * not a cosmetic distinction here: it is a false claim to a bank.
 */

export type ArrivalState =
  | { done: false; error?: string }
  | { done: true; already: boolean };

export async function confirmArrival(
  _prev: ArrivalState,
  formData: FormData,
): Promise<ArrivalState> {
  const token = String(formData.get("token") ?? "");
  if (!token) return { done: false, error: "invalid" };

  /*
   * DECISION B — fails closed (public write, and token guessing).
   *
   * Unauthenticated, and the token is the whole authorisation. Failing open
   * leaves an unmetered oracle over every order id for as long as Redis is down,
   * and each guess writes.
   *
   * `outage` is answered separately below, because a refusal here is *not* an
   * answer about the order: telling a buyer holding a real link that it opens
   * nothing would be a negative answer to a question nobody asked. Rule 5.
   */
  const gate = await rateLimit(`arrival:${await callerIp()}`, 20, 300, {
    onOutage: "closed",
  });
  if (!gate.allowed) {
    return { done: false, error: gate.reason === "outage" ? "unavailable" : "busy" };
  }

  const orderId = readArrivalToken(token);
  if (!orderId) return { done: false, error: "invalid" };

  const result = await confirmDelivery({ orderId, source: "buyer_confirmed" });
  if (!result.ok) {
    return { done: false, error: result.error === "not_found" ? "invalid" : "unavailable" };
  }

  /*
   * The seller's own list shows a "delivered" mark now, so the cached view of
   * their shop has to be given the chance to notice. Best effort: the record is
   * written either way, and a stale panel is a smaller problem than an error on
   * a page a buyer is looking at.
   */
  try {
    const order = await getDb().query.orders.findFirst({
      where: eq(orders.id, orderId),
      columns: { shopId: true },
    });
    if (order) await revalidateShop(order.shopId);
  } catch (error) {
    console.error("[sailo] arrival revalidate failed", error);
  }

  return { done: true, already: result.alreadyConfirmed };
}
