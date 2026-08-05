import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, type Shop } from "@/db/schema";
import { createCheckoutSession } from "@/lib/connect";
import { restoreStock } from "@/lib/inventory";
import type { Handoff } from "@/lib/payments";

/**
 * Sending a card buyer to Stripe.
 *
 * Runs only once the order row exists: the Checkout Session carries its id so
 * the webhook can find it again, and every amount comes from the saved row
 * rather than from anything the client sent.
 */

export type CardHandoffResult =
  | { ok: true; handoff: Handoff }
  | { ok: false; error: string };

export async function handOffToStripe(opts: {
  shop: Shop;
  orderId: string;
  /** The basket, so Stripe's receipt itemises it rather than naming one line. */
  items: { name: string; unitPriceCents: number; quantity: number }[];
  successUrl: string;
  cancelUrl: string;
}): Promise<CardHandoffResult> {
  const db = getDb();

  // The insert returns only an id; the session and the rollback both need the
  // whole row, so it is read back once here rather than widening what every
  // other caller gets.
  const saved = await db.query.orders.findFirst({
    where: eq(orders.id, opts.orderId),
  });
  if (!saved) return { ok: false, error: "Couldn't start the payment." };

  try {
    const session = await createCheckoutSession({
      shop: opts.shop,
      order: saved,
      items: opts.items,
      successUrl: opts.successUrl,
      cancelUrl: opts.cancelUrl,
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL");

    await db
      .update(orders)
      .set({
        stripeSessionId: session.id,
        stripeAccountId: opts.shop.stripeAccountId,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, saved.id));

    return { ok: true, handoff: { kind: "redirect", url: session.url } };
  } catch (error) {
    /*
     * The order and its stock reservation already exist.
     *
     * Rolling both back is the only honest outcome: an order nobody can pay
     * for would hold units the seller could otherwise sell, and it would sit
     * in their list looking like a sale that never happened.
     */
    await restoreStock(saved);
    await db.delete(orders).where(eq(orders.id, saved.id));

    console.error("[sailo] stripe checkout session failed", error);
    return {
      ok: false,
      error: "Card payment isn't available right now. Try another way to order.",
    };
  }
}
