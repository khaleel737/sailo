import { NextResponse } from "next/server";
import { firstRow } from "@/lib/invariant";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, shops, stripeEvents } from "@/db/schema";
import { stripe } from "@/lib/stripe";
import { restoreStock } from "@/lib/inventory";
import { freePlanFields, subscriptionFields } from "@/lib/billing-map";

/**
 * Events we act on. Anything else is acknowledged and ignored.
 *
 * Two different things arrive here. Events *about Sailo's own account* are
 * subscription billing — a seller paying us. Events carrying an `account`
 * field come from a connected account and are a buyer paying a seller. Same
 * endpoint, same signature, opposite meaning, so the two are dispatched apart
 * before anything is read from the payload.
 */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "charge.refunded",
  "checkout.session.expired",
  "account.updated",
]);

async function shopIdFor(opts: {
  shopId?: string | null;
  customerId?: string | null;
}) {
  const db = getDb();
  if (opts.shopId) {
    const byId = await db.query.shops.findFirst({
      where: eq(shops.id, opts.shopId),
      columns: { id: true },
    });
    if (byId) return byId.id;
  }
  if (opts.customerId) {
    const byCustomer = await db.query.shops.findFirst({
      where: eq(shops.stripeCustomerId, opts.customerId),
      columns: { id: true },
    });
    if (byCustomer) return byCustomer.id;
  }
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET is not set" },
      { status: 500 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  // The raw body is required — parsing it first would break verification.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    return NextResponse.json(
      {
        error: `signature verification failed: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      },
      { status: 400 },
    );
  }

  const db = getDb();

  // Stripe delivers at least once; recording the id first makes replays no-ops.
  const claimed = firstRow(await db
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing({ target: stripeEvents.id })
    .returning({ id: stripeEvents.id }), "claimed");

  if (!claimed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (!HANDLED.has(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  /*
   * Route by what the event *is*, not only by where it came from.
   *
   * A connected account's events always belong to a shop order, but the
   * converse doesn't hold: a session for a shop order can also arrive without
   * an `account` field, because a seller whose Stripe account is the platform's
   * own is charged directly. Dispatching on `event.account` alone sent those
   * into the subscription branch, which ignored them, and the order sat unpaid
   * forever with the buyer's money taken.
   */
  const isShopOrder =
    Boolean(event.account) ||
    event.type === "charge.refunded" ||
    event.type === "account.updated" ||
    event.type === "checkout.session.expired" ||
    (event.type === "checkout.session.completed" &&
      (event.data.object as Stripe.Checkout.Session).mode === "payment");

  if (isShopOrder) {
    try {
      const outcome = await handleShopEvent(event, event.account ?? null);
      return NextResponse.json({ received: true, shop: outcome });
    } catch (error) {
      await db.delete(stripeEvents).where(eq(stripeEvents.id, event.id));
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "shop handler failed" },
        { status: 500 },
      );
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const shopId = await shopIdFor({
          shopId: session.client_reference_id ?? session.metadata?.shopId,
          customerId:
            typeof session.customer === "string" ? session.customer : null,
        });
        if (!shopId || !session.subscription) break;

        // Read the subscription back rather than trusting the session shape.
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;
        const sub = await stripe().subscriptions.retrieve(subId);

        await db
          .update(shops)
          .set({
            ...subscriptionFields(sub),
            stripeCustomerId:
              typeof session.customer === "string" ? session.customer : undefined,
          })
          .where(eq(shops.id, shopId));
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const shopId = await shopIdFor({
          shopId: sub.metadata?.shopId,
          customerId: typeof sub.customer === "string" ? sub.customer : null,
        });
        if (!shopId) break;

        await db
          .update(shops)
          .set(subscriptionFields(sub))
          .where(eq(shops.id, shopId));
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const shopId = await shopIdFor({
          shopId: sub.metadata?.shopId,
          customerId: typeof sub.customer === "string" ? sub.customer : null,
        });
        if (!shopId) break;

        await db
          .update(shops)
          .set(freePlanFields())
          .where(eq(shops.id, shopId));
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const shopId = await shopIdFor({
          customerId:
            typeof invoice.customer === "string" ? invoice.customer : null,
        });
        if (!shopId) break;

        // Stripe keeps retrying; reflect the state but don't revoke access yet.
        await db
          .update(shops)
          .set({ subscriptionStatus: "past_due", updatedAt: new Date() })
          .where(eq(shops.id, shopId));
        break;
      }
    }
  } catch (error) {
    // Release the idempotency claim so Stripe's retry can have another go.
    await db.delete(stripeEvents).where(eq(stripeEvents.id, event.id));
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "webhook handler failed",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true, handled: event.type });
}

/**
 * A buyer's payment on a seller's connected account.
 *
 * The order is found by session id, then by the order id we put in metadata —
 * the second is a fallback for the case where the session id write lost a race
 * with a very fast webhook.
 */
async function handleShopEvent(event: Stripe.Event, accountId: string | null) {
  const db = getDb();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== "paid") return "unpaid";

      const orderId =
        session.client_reference_id ?? session.metadata?.orderId ?? null;

      const order = session.id
        ? ((await db.query.orders.findFirst({
            where: eq(orders.stripeSessionId, session.id),
          })) ??
          (orderId
            ? await db.query.orders.findFirst({ where: eq(orders.id, orderId) })
            : null))
        : null;
      if (!order) return "order not found";

      // Payment is what confirms the order, so the seller never has to.
      await db
        .update(orders)
        .set({
          paymentStatus: "paid",
          status: order.status === "new" ? "confirmed" : order.status,
          stripePaymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : (session.payment_intent?.id ?? null),
          stripeAccountId: accountId ?? order.stripeAccountId,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      return `order ${order.id} paid`;
    }

    /*
     * The buyer opened Stripe and never paid.
     *
     * Stock is taken when the order is written, before the money arrives —
     * otherwise two buyers can be sold the same last unit while one of them is
     * still typing a card number. The cost is that an abandoned checkout holds
     * those units, so Stripe's expiry is what gives them back. Without this a
     * shop quietly sells out of things it still has.
     */
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const order = await db.query.orders.findFirst({
        where: eq(orders.stripeSessionId, session.id),
      });
      if (!order) return "order not found";
      if (order.paymentStatus === "paid") return "already paid";

      await restoreStock(order);
      await db
        .update(orders)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(orders.id, order.id));

      return `order ${order.id} expired and restocked`;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const intentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : (charge.payment_intent?.id ?? null);
      if (!intentId) return "no payment intent";

      const order = await db.query.orders.findFirst({
        where: eq(orders.stripePaymentIntentId, intentId),
      });
      if (!order) return "order not found";

      // Mirrors a refund issued from Stripe's own dashboard, so the seller's
      // revenue figures match their bank either way.
      await db
        .update(orders)
        .set({
          refundedCents: charge.amount_refunded,
          paymentStatus: charge.refunded ? "refunded" : order.paymentStatus,
          status: charge.refunded ? "refunded" : order.status,
          refundedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      return `order ${order.id} refunded`;
    }

    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      // Stripe can enable or restrict an account at any time; mirroring it
      // keeps the card button off the storefront while a seller is blocked.
      await db
        .update(shops)
        .set({
          stripeChargesEnabled: Boolean(account.charges_enabled),
          stripeDetailsSubmitted: Boolean(account.details_submitted),
          updatedAt: new Date(),
        })
        .where(eq(shops.stripeAccountId, account.id));
      return `account ${account.id} synced`;
    }

    default:
      return `ignored ${event.type}`;
  }
}
