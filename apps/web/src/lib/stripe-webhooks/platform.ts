import "server-only";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { revalidateShop } from "@/lib/cache";
import { publishShopEvent } from "@sailo/events";
import { freePlanFields, subscriptionFields } from "@sailo/billing/map";
import {
  recordReferralEarning,
  reverseReferralEarning,
} from "@/lib/partners/store";
import { shopIdFor, stripe } from "@sailo/payments";

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
        // The seller may be staring at the billing page this checkout
        // started from, and /hq/revenue counts this subscription now.
        await publishShopEvent(shopId, "account");
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
        await publishShopEvent(shopId, "account");
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
        await publishShopEvent(shopId, "account");
        break;
      }

      /*
       * A seller paid us — which is the moment whoever referred them earns.
       *
       * Here rather than on `customer.subscription.created`, because a
       * subscription is a promise and an invoice is money. A trial creates a
       * subscription and pays nothing; commission on that would be paid out
       * of Sailo's pocket for revenue that may never arrive.
       *
       * `amount_paid`, not the plan price: a prorated upgrade, a coupon or a
       * partial credit all mean we received less than list, and the referrer's
       * share is a share of what we actually took.
       */
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.amount_paid <= 0) break;

        const shopId = await shopIdFor({
          customerId:
            typeof invoice.customer === "string" ? invoice.customer : null,
        });
        if (!shopId) break;

        /*
         * Idempotent by constraint, not by this call site — the unique index
         * on (invoice, kind) is what makes Stripe's at-least-once delivery
         * safe. `stripeEvents` already de-duplicates whole events; this
         * survives the case that one does not cover, which is the same
         * invoice arriving under two different event ids.
         */
        await recordReferralEarning({
          referredShopId: shopId,
          stripeInvoiceId: invoice.id,
          invoiceAmountCents: invoice.amount_paid,
          currency: invoice.currency,
        });
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
        // "Past due" is a banner in the seller's panel and a row on
        // /hq/revenue's at-risk list; both should appear without a reload.
        await publishShopEvent(shopId, "account");
        break;
      }
  }

  return `handled ${event.type}`;
}

/**
 * We handed a seller their subscription money back, so the referral
 * commission on it comes back too.
 *
 * Reached from the Connect handler rather than from the switch above, because
 * `charge.refunded` arriving with no `account` is genuinely ambiguous: it is
 * either a direct-charge seller refunding a buyer, or this. The order lookup
 * is what separates them, and that lookup lives over there — so it asks here
 * only once it knows the refund matched no order at all.
 *
 * The reversal is appended as a negative row, never by editing or deleting
 * the earning that recorded what we owed at the time. `amount_refunded` is
 * the running total on the charge, and `reverseReferralEarning` clamps to the
 * earning it undoes, so a second partial refund cannot claw back more than we
 * ever credited.
 */
export async function handleSubscriptionRefund(
  charge: Stripe.Charge,
): Promise<string> {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) return "refund carries no payment intent";

  /*
   * One lookup, because a Charge can no longer name its invoice: in this API
   * version an invoice's payments are their own objects. It costs a round
   * trip on a refund that matched no order — rare twice over — and it is the
   * only thing that can tell us whether this refund was one of ours.
   */
  const payments = await stripe().invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    limit: 1,
  });

  const link = payments.data[0]?.invoice;
  const invoiceId = typeof link === "string" ? link : link?.id;
  if (!invoiceId) return "refund is not for a Sailo invoice";

  const reversed = await reverseReferralEarning({
    stripeInvoiceId: invoiceId,
    refundedCents: charge.amount_refunded,
  });

  return reversed
    ? `referral commission reversed on ${invoiceId}`
    : `no referral commission on ${invoiceId}`;
}

