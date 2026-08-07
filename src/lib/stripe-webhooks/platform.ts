import "server-only";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shops } from "@/db/schema";
import { stripe } from "@/lib/stripe";
import { revalidateShop } from "@/lib/cache";
import { freePlanFields, subscriptionFields } from "@/lib/billing-map";
import { shopIdFor } from "./ownership";

/**
 * Sailo's own account: a seller paying us.
 *
 * Nothing here touches an order — these are subscriptions and the invoices
 * behind them. The shop is found by the id we put in metadata, falling back to
 * the Stripe customer, because a subscription created outside our checkout has
 * only the customer to go on.
 */
/**
 * Drops a shop's cached storefront after a write that changed what it may sell.
 *
 * `getShopByHandle` and `getCheckoutOptions` are `cacheLife("max")` — they
 * never expire on a clock, only on a tag — and both bake in `plan` and
 * `stripeChargesEnabled`. Every seller-facing write already calls
 * `revalidateShop`; the webhooks, which are where a *subscription* actually
 * lapses and where Stripe actually restricts an account, did not. The result
 * was a cache that lied about money in both directions: a lapsed seller kept
 * a card button their buyers could press and `createOrderIntent` would then
 * refuse, and a seller who upgraded — or whom Stripe re-enabled — did not get
 * one until they happened to edit something unrelated.
 *
 * Takes the handle so the handle-keyed entry goes too, and reads it back
 * rather than trusting the caller to have it.
 */
async function dropShopCache(shopId: string) {
  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.id, shopId),
    columns: { handle: true },
  });
  revalidateShop(shopId, shop?.handle);
}

export async function handleAccountEvent(event: Stripe.Event): Promise<string> {
  const db = getDb();

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
        await dropShopCache(shopId);
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
        await dropShopCache(shopId);
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
        // A lapsed subscription that the storefront never hears about keeps
        // selling on a plan the seller no longer pays for.
        await dropShopCache(shopId);
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

  return `handled ${event.type}`;
}

