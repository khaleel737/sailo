import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shops, stripeEvents } from "@/db/schema";
import { stripe } from "@/lib/stripe";
import { freePlanFields, subscriptionFields } from "@/lib/billing-map";

/** Events we act on. Anything else is acknowledged and ignored. */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
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
  const [claimed] = await db
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing({ target: stripeEvents.id })
    .returning({ id: stripeEvents.id });

  if (!claimed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (!HANDLED.has(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type });
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
          .set({ ...freePlanFields, updatedAt: new Date() })
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
