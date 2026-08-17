/**
 * A recurring charge on the seller's own account.
 *
 * Everything in `./card-checkout` bills once from amounts we computed. This hands Stripe a
 * Price and lets it bill on its own schedule for ever, which changes what we are responsible
 * for: the amount becomes Stripe's to compute at each renewal rather than ours to restate.
 * That is a different enough contract to be a different file.
 */

import "server-only";
import { toStripeAmount } from "@sailo/core/currency";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products, type Order, type Product, type Shop } from "@sailo/db/schema";
import { actingAs, stripe } from "@sailo/payments";
import { platformFeePercent } from "@sailo/core/plans";
import { intervalOf, membershipSellable, normalizeTrialDays, priceIsStale } from "../memberships/memberships";

/* --------------------------------------------------------------------------
   Memberships

   A recurring charge on the seller's own account. Everything above bills once
   from amounts we computed; this hands Stripe a Price and lets it bill on its
   own schedule forever, which changes three things and only three:

     - the amount is Stripe's to compute at each renewal, not ours to restate;
     - the fee is a percentage rather than a fixed amount, because we do not
       know what the next invoice will come to;
     - the money arrives on `invoice.paid` rather than on the session.
-------------------------------------------------------------------------- */

/**
 * The Stripe Price this product currently sells at, minting one if needed.
 *
 * A Price is immutable in Stripe: there is no edit. So a seller who changes
 * what a membership costs gets a *new* Price, this column is repointed at it,
 * and existing members keep billing at the one they signed up on until they
 * cancel and resubscribe. That is not a limitation being worked around — it is
 * the correct behaviour for a subscription, and Stripe enforcing it is
 * convenient.
 *
 * Created on the connected account, so the Price belongs to the seller and
 * disappears with them if they disconnect.
 */
export async function membershipPrice(
  shop: Shop,
  product: Product,
  /**
   * The membership's cover image, so the subscribe page shows the thing being
   * subscribed to. Optional because the two callers differ: the checkout has
   * the gallery to hand, and the webhook that renews an existing member has no
   * need to mint a Price at all.
   *
   * Only read when a Price is actually created. A Stripe Price is immutable
   * and the Product behind it is created with it, so a seller who adds a photo
   * to an existing membership will not see it on Stripe's page until the
   * *price* changes and a new one is minted. Refreshing it otherwise would
   * mean an extra `products.update` on every subscribe to keep a thumbnail
   * current, which is not a trade worth making on the money path.
   */
  imageUrl?: string | null,
): Promise<string> {
  if (!shop.stripeAccountId) throw new Error("Shop has no connected Stripe account");
  if (!product.stripePriceId || priceIsStale(product)) {
    const image = imageUrl?.trim().startsWith("https://") ? imageUrl.trim() : null;
    const description = product.description?.trim();

    const price = await stripe().prices.create(
      {
        currency: shop.currency.toLowerCase(),
        unit_amount: toStripeAmount(product.priceCents, shop.currency),
        recurring: { interval: intervalOf(product) },
        product_data: {
          name: product.title,
          ...(description ? { description: description.slice(0, 300) } : {}),
          ...(image ? { images: [image] } : {}),
        },
        metadata: { productId: product.id, shopId: shop.id },
      },
      actingAs(shop.stripeAccountId),
    );

    /*
     * Written back with the amount it was minted for, not just the id. The
     * id alone cannot answer "is this still the right price", so a later edit
     * to `priceCents` would go unnoticed and every new member would be
     * charged the old amount — silently, forever, on a row that looks correct.
     */
    await getDb()
      .update(products)
      .set({
        stripePriceId: price.id,
        stripePriceCents: product.priceCents,
        stripePriceInterval: intervalOf(product),
        updatedAt: new Date(),
      })
      .where(eq(products.id, product.id));

    return price.id;
  }

  return product.stripePriceId;
}

/**
 * The Checkout Session a member subscribes through.
 *
 * `mode: "subscription"`, on the connected account, so the arrangement belongs
 * to the seller: their customer, their subscription, their billing portal, and
 * their money — Sailo takes a percentage and never holds the rest.
 *
 * One line, quantity one. A subscription checkout cannot carry a mug as well,
 * which is why `resolveLines` refuses a mixed basket before anybody gets here;
 * this function asserts it rather than trusting it.
 */
export async function createSubscriptionSession(opts: {
  shop: Shop;
  order: Order;
  product: Product;
  /** The membership's cover, for the Price's Product. See `membershipPrice`. */
  imageUrl?: string | null;
  successUrl: string;
  cancelUrl: string;
}) {
  const { shop, order, product } = opts;
  if (!shop.stripeAccountId) throw new Error("Shop has no connected Stripe account");
  if (!membershipSellable(product)) {
    throw new Error(`Product ${product.id} is not a sellable membership`);
  }

  const price = await membershipPrice(shop, product, opts.imageUrl);
  const feePercent = platformFeePercent(shop);
  const trialDays = normalizeTrialDays(product.trialDays);

  return stripe().checkout.sessions.create(
    {
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      customer_email: order.customerEmail ?? undefined,
      client_reference_id: order.id,
      /*
       * On the session *and* on the subscription.
       *
       * They are read by different events: `checkout.session.completed`
       * carries the session's, and every later `customer.subscription.*` and
       * `invoice.*` carries only the subscription's. A renewal eleven months
       * from now has no session to look at, so metadata that lived only there
       * would leave the webhook unable to say which shop was being paid.
       */
      metadata: {
        orderId: order.id,
        shopId: shop.id,
        productId: product.id,
        ...(order.clientId ? { clientId: order.clientId } : {}),
      },
      subscription_data: {
        metadata: {
          orderId: order.id,
          shopId: shop.id,
          productId: product.id,
          ...(order.clientId ? { clientId: order.clientId } : {}),
        },
        ...(trialDays ? { trial_period_days: trialDays } : {}),
        /*
         * Sailo's cut, as a percentage rather than an amount.
         *
         * A one-time charge names `application_fee_amount` because we know
         * what the total is. Here we do not: Stripe raises each invoice, and
         * a proration, a coupon the seller applies in their own dashboard, or
         * a tax line all change what it comes to. A percentage is applied to
         * whatever the invoice actually is, which is the only version of the
         * fee that stays correct at renewal number fourteen.
         */
        ...(feePercent > 0 ? { application_fee_percent: feePercent } : {}),
      },
      // The shop picked its currency and the order records it; letting Stripe
      // convert would put our books and the seller's payout in two currencies.
      adaptive_pricing: { enabled: false },
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
    },
    actingAs(shop.stripeAccountId),
  );
}

/**
 * A link into Stripe's own billing portal, for the member rather than the
 * seller.
 *
 * Created on the connected account with the member's customer id, so it shows
 * their card and their subscription to this one shop and nothing else. This is
 * how a member cancels: Stripe hosts the page, handles the confirmation, and
 * sends us `customer.subscription.updated` — which means we never write a
 * cancellation flow, never store a card, and never have a bug where the
 * button said "cancelled" and Stripe kept charging.
 */
