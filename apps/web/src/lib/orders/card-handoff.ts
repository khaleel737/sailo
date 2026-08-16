import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, type Product, type Shop } from "@sailo/db/schema";
import { createCheckoutSession, createSubscriptionSession } from "@/lib/connect";
import { abandonOrder } from "@sailo/commerce/inventory";
import type { CheckoutLine } from "@/lib/orders/checkout-lines";
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
  /**
   * The basket, described, so Stripe's page itemises it with pictures and
   * subtitles rather than naming one line. Built by `toCheckoutLine`.
   */
  items: CheckoutLine[];
  successUrl: string;
  cancelUrl: string;
  /** Passed to Stripe so the webhook can issue the invoice after payment. */
  invoiceToken: string;
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
      invoiceToken: opts.invoiceToken,
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
     *
     * `abandonOrder` rather than `restoreStock`, so the coupon goes back too —
     * it is the same undo the expiry webhook and the sweep perform, and doing
     * it here is what lets the caller stop doing it separately.
     */
    await abandonOrder(saved);
    await db.delete(orders).where(eq(orders.id, saved.id));

    console.error("[sailo] stripe checkout session failed", error);
    return {
      ok: false,
      error: "Card payment isn't available right now. Try another way to order.",
    };
  }
}

/**
 * Sending a member to Stripe.
 *
 * The sibling of `handOffToStripe`, and deliberately not a flag on it. The two
 * differ in what happens *after* a failure as much as in the session they
 * create: both roll the order back, but this one has no stock to hand back and
 * no coupon to release, and — more importantly — the thing it creates is a
 * standing arrangement rather than a payment, so the row it leaves behind on
 * success means "waiting for the first invoice" rather than "waiting for a
 * charge".
 *
 * No invoice token. A membership's invoice is raised by Stripe on each billing
 * cycle and our own invoice row is written when `invoice.paid` arrives, so
 * there is nothing to name in the success URL before the money exists.
 */
export async function handOffSubscription(opts: {
  shop: Shop;
  orderId: string;
  product: Product;
  /** The membership's cover image, for the Stripe Product behind its Price. */
  imageUrl?: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<CardHandoffResult> {
  const db = getDb();

  const saved = await db.query.orders.findFirst({
    where: eq(orders.id, opts.orderId),
  });
  if (!saved) return { ok: false, error: "Couldn't start the payment." };

  try {
    const session = await createSubscriptionSession({
      shop: opts.shop,
      order: saved,
      product: opts.product,
      imageUrl: opts.imageUrl,
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
     * The order goes, exactly as it does on the one-time path.
     *
     * `abandonOrder` is not called: a membership reserves no stock and carries
     * no coupon, so there is nothing to give back — and calling it would mean
     * a restock pass over a product that never held units, which reads as if
     * memberships had inventory.
     */
    await db.delete(orders).where(eq(orders.id, saved.id));

    console.error("[sailo] stripe subscription session failed", error);
    return {
      ok: false,
      error: "Memberships aren't available right now. Try again in a moment.",
    };
  }
}
