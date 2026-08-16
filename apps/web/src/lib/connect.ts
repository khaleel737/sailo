import "server-only";
import { toStripeAmount } from "@sailo/core/currency";
import { checkoutShipping, type CheckoutLine } from "@/lib/orders/checkout-lines";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products, shops, type Order, type Product, type Shop } from "@sailo/db/schema";
import { lineTitle, orderLines, orderSummaryTitle } from "@/lib/order-lines";
import {
  accountFields,
  actingAs,
  connectOnboardingLink,
  publicShopUrl as shopUrlUnder,
  stripe,
} from "@sailo/payments";
/*
 * Four calls that used to be written out below and now live in
 * `@sailo/payments/connect`, because the phone has to make them too and
 * `packages/api` cannot import from this app.
 *
 * Re-exported rather than merely imported: twenty-odd call sites in here and
 * in `lib/actions/` reach them through `@/lib/connect`, and the point of the
 * lift was to have one implementation, not to make everyone update an import.
 * `lib/payments/rails.ts` did the same thing for the same reason.
 *
 * `refundCharge` in particular must not be re-implemented here. It passes
 * `refund_application_fee`, and a copy that forgot it would refund the buyer
 * in full while Sailo kept its cut of a sale that got undone.
 */
export {
  actingAs,
  billingPortalSession,
  cancelSubscriptionAtPeriodEnd,
} from "@sailo/payments";
import { appUrl } from "@/lib/app-url";
import { taxName } from "@/lib/tax-label";
import { platformFeeCents, platformFeePercent } from "@/lib/plans";
import {
  intervalOf,
  membershipSellable,
  normalizeTrialDays,
  priceIsStale,
} from "@/lib/memberships";

/**
 * Card payments through the seller's own Stripe account, using Connect.
 *
 * Express accounts: Stripe hosts the onboarding and the payouts dashboard, so
 * Sailo never sees bank details, never holds funds, and never stores anyone's
 * API keys — we hold an account id and act on their behalf with it.
 *
 * Sailo takes a platform fee on card sales — see `platformFeeCents`. It is
 * named on the charge in `createCheckoutSession` and handed back in
 * `refundCharge`, so a refunded order refunds our share too. Both are the only
 * places in the codebase that move money to us, deliberately.
 *
 * Opening the account lives in `@sailo/payments/connect` rather than here,
 * because the phone starts that flow too. What stays in this file is
 * everything a browser is the only possible caller of, plus the two-line
 * bindings that tell the shared code where *this* deployment sends people.
 */

export const disconnectedFields = {
  stripeAccountId: null,
  stripeChargesEnabled: false,
  stripeDetailsSubmitted: false,
  stripeAccountCountry: null,
  stripeConnectedAt: null,
};

/**
 * The shop's public address, as this deployment serves it.
 *
 * The rule about which addresses Stripe will accept is shared — the phone
 * opens the same kind of account — so it lives in `@sailo/payments`. What is
 * web's alone is knowing where "here" is, which is the one thing this adds.
 */
export function publicShopUrl(handle: string): string | null {
  return shopUrlUnder(appUrl(), handle);
}

/**
 * Sends the seller to Stripe to create or finish their account, and comes
 * back to the admin.
 *
 * The flow itself is shared; only these two URLs are web's. The app calls the
 * same function with `sailo://` redirects, which is what lets its browser
 * sheet close itself instead of asking the seller to find a Close button.
 */
export async function startOnboarding(shop: Shop) {
  return connectOnboardingLink(shop, {
    siteUrl: appUrl(),
    returnUrl: `${appUrl()}/admin/payments?stripe=return`,
    // Refresh is what Stripe calls when the link has expired — it must start
    // the flow again, not dead-end on an error page. `/admin/payments` renders
    // the Connect card, from which the seller presses Connect again.
    refreshUrl: `${appUrl()}/admin/payments?stripe=refresh`,
  });
}

/**
 * Re-reads the account from Stripe and stores its state.
 *
 * Onboarding finishing is not the same as being able to charge — Stripe may
 * still be verifying — so the return redirect syncs rather than assuming.
 */
export async function syncAccount(shop: Shop) {
  if (!shop.stripeAccountId) return null;

  let account: Stripe.Account;
  try {
    account = await stripe().accounts.retrieve(shop.stripeAccountId);
  } catch {
    // Deleted or rejected on Stripe's side: clear it so the seller can start
    // over rather than being stuck pointing at an account that isn't there.
    await getDb()
      .update(shops)
      .set({ ...disconnectedFields, updatedAt: new Date() })
      .where(eq(shops.id, shop.id));
    return null;
  }

  await getDb()
    .update(shops)
    .set({ ...accountFields(account), updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  return account;
}

/** A link into Stripe's own dashboard for the connected account. */
export async function loginLink(accountId: string) {
  const link = await stripe().accounts.createLoginLink(accountId);
  return link.url;
}

export type ConnectState =
  | "not_connected"
  | "onboarding"
  | "verifying"
  | "active";

export function connectState(shop: {
  stripeAccountId: string | null;
  stripeDetailsSubmitted: boolean;
  stripeChargesEnabled: boolean;
}): ConnectState {
  if (!shop.stripeAccountId) return "not_connected";
  if (!shop.stripeDetailsSubmitted) return "onboarding";
  if (!shop.stripeChargesEnabled) return "verifying";
  return "active";
}

/**
 * The Checkout Session a card buyer is sent to.
 *
 * Created **on the connected account** (`stripeAccount`), which makes it a
 * direct charge: the money never passes through Sailo's balance.
 *
 * The line items restate the order rather than pointing at a Stripe product —
 * Sailo's catalogue is the source of truth and mirroring it into Stripe would
 * be a second thing to keep in sync.
 *
 * Amounts come from the order row, which was computed server-side, so a
 * tampered client can't change what Stripe charges.
 */
export async function createCheckoutSession(opts: {
  shop: Shop;
  order: Order;
  /**
   * Every line, already described. Required: the order's header columns
   * describe one line, and charging from them billed a four-line basket for
   * its first item.
   *
   * `description` and `images` are what the buyer sees on Stripe's page beside
   * the price. They are built by `toCheckoutLine` at the call site rather than
   * here, because composing them needs the product row and the shop's
   * dictionary, and this function has neither.
   */
  items: CheckoutLine[];
  /** Where to send the buyer afterwards. */
  successUrl: string;
  cancelUrl: string;
  /**
   * The invoice's public token, minted before the invoice exists so the
   * success URL can name it. Carried in metadata for the webhook to issue the
   * invoice against once the money has actually arrived.
   */
  invoiceToken?: string;
}) {
  const { shop, order } = opts;
  if (!shop.stripeAccountId) throw new Error("Shop has no connected Stripe account");

  const currency = order.currency.toLowerCase();
  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

  /*
   * The basket. A caller that already priced the order can pass its lines to
   * save a query; otherwise they come from `orderItems`.
   *
   * The header columns are the last resort, not the default. They describe a
   * single line, so using them for a cart quietly bills the first item and
   * drops the rest — a four-line order came out $62 short before this read
   * the item rows.
   */
  // The basket, always from the order's own lines. `items` is a hand-off from
  // a caller that already priced them; the accessor is the same source either
  // way, so there is no path here that prices from the single-item header.
  /*
   * The fallback carries a picture but no description. `orderItems` snapshots
   * the image, the title and the variant — enough to render the line properly
   * — but not the duration, the booked time or the seller's copy, which live
   * on the product and would need it re-read. Every buyer-facing path passes
   * `items`; this is for a caller that only has an order id, and a thumbnail
   * without a subtitle is a long way better than what it replaced.
   */
  const goods: CheckoutLine[] = opts.items.length
    ? opts.items
    : (await orderLines(order)).map((l) => ({
        name: lineTitle(l),
        ...(l.imageUrl?.startsWith("https://") ? { images: [l.imageUrl] } : {}),
        unitPriceCents: l.unitPriceCents,
        quantity: l.quantity,
      }));

  // Whatever the source, Stripe must ask for exactly what the order says.
  const goodsTotal = goods.reduce(
    (sum, g) => sum + g.unitPriceCents * g.quantity,
    0,
  );
  if (goodsTotal !== order.subtotalCents) {
    throw new Error(
      `Checkout lines total ${goodsTotal} but the order subtotal is ` +
        `${order.subtotalCents}. Refusing to charge a different amount.`,
    );
  }

  /*
   * And the same question about the whole charge, not just the goods.
   *
   * The check above compares unrounded numbers, so it passed while every line
   * was then rounded on its way to Stripe — which is how a three-decimal
   * currency ended up charging something the order had never said. The order
   * is rounded at creation now, so these agree by construction; this asserts
   * it rather than trusting it, because the failure mode is a card statement
   * that disagrees with an invoice and nothing anywhere that would notice.
   */
  const chargeable = (n: number) => toStripeAmount(n, currency);
  const stripeTotal =
    goods.reduce((sum, g) => sum + chargeable(g.unitPriceCents) * g.quantity, 0) +
    chargeable(order.deliveryFeeCents) +
    (order.taxInclusive ? 0 : chargeable(order.taxCents)) -
    chargeable(order.discountCents);

  if (stripeTotal !== order.totalCents) {
    throw new Error(
      `Stripe would be asked for ${stripeTotal} but the order total is ` +
        `${order.totalCents}. Refusing to charge a different amount.`,
    );
  }

  /*
   * The goods, at the unit price actually charged. Quantity is a separate
   * field so Stripe's receipt reads "3 × Speckled Mug" rather than one lump.
   *
   * The buyer's note used to be squeezed into the first line's description.
   * It has moved to `payment_intent_data.metadata` below — now that lines
   * carry a real description of their own, putting the note there would
   * overwrite "Takes 45 minutes · In person · Thu 3 Mar, 14:00" with a
   * sentence about gift wrapping on one arbitrary line of the basket. The
   * note's real reader is the seller, and metadata is where they find it.
   */
  for (const item of goods) {
    line_items.push({
      quantity: item.quantity,
      price_data: {
        currency,
        unit_amount: toStripeAmount(item.unitPriceCents, currency),
        product_data: {
          name: item.name,
          ...(item.description ? { description: item.description } : {}),
          ...(item.images?.length ? { images: item.images } : {}),
        },
      },
    });
  }

  if (order.deliveryFeeCents > 0) {
    line_items.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: toStripeAmount(order.deliveryFeeCents, currency),
        product_data: { name: order.deliveryLabel ?? "Delivery" },
      },
    });
  }

  // Exclusive tax is a line the buyer pays on top. Inclusive tax is already
  // inside the unit price and must not be added again.
  if (order.taxCents > 0 && !order.taxInclusive) {
    line_items.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: toStripeAmount(order.taxCents, currency),
        product_data: { name: taxName(order) },
      },
    });
  }

  // A coupon is applied as a Stripe discount so the buyer sees the reduction
  // on Stripe's page rather than a total that silently disagrees with ours.
  // Sailo's share of the goods, before Stripe takes its own from the seller.
  const applicationFee = platformFeeCents(shop, order);

  let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
  if (order.discountCents > 0) {
    const coupon = await stripe().coupons.create(
      {
        amount_off: toStripeAmount(order.discountCents, currency),
        currency,
        duration: "once",
        name: order.couponCode ?? "Discount",
      },
      actingAs(shop.stripeAccountId),
    );
    discounts = [{ coupon: coupon.id }];
  }

  const shipping = checkoutShipping(order);

  return stripe().checkout.sessions.create(
    {
      mode: "payment",
      line_items,
      discounts,
      customer_email: order.customerEmail ?? undefined,
      client_reference_id: order.id,
      // The webhook may arrive on the platform endpoint with only the event to
      // go on, so the order id travels on both the session and the payment.
      /*
       * `invoiceToken` rides along because the invoice is not issued until the
       * money arrives, and the success URL has to name it before that. The
       * webhook reads it back and creates the invoice with the same token, so
       * the link the buyer was given resolves the moment they return.
       */
      metadata: {
        orderId: order.id,
        shopId: shop.id,
        ...(opts.invoiceToken ? { invoiceToken: opts.invoiceToken } : {}),
      },
      payment_intent_data: {
        metadata: {
          orderId: order.id,
          shopId: shop.id,
          // The buyer's note, where the seller actually reads it: on the
          // payment in their own Stripe dashboard, beside the money. It used
          // to be the first line item's description, which is now spoken for.
          ...(order.note ? { note: order.note.slice(0, 500) } : {}),
        },
        description: `${shop.name} — ${orderSummaryTitle(order)}`,
        /*
         * Where the goods are going.
         *
         * Not `shipping_address_collection`, which would make Stripe ask for
         * an address the buyer has already given us — Sailo's own cart
         * collects it before the redirect, and asking twice is how a delivery
         * fee gets quoted against one address and the parcel sent to another.
         * This states the address we already hold instead.
         *
         * Its absence was quietly expensive: the seller's Stripe dashboard,
         * the Stripe receipt and any dispute evidence all showed a payment
         * with nowhere to send it, and "no shipping address on file" is a
         * losing position in a chargeback over an undelivered parcel.
         *
         * Only for orders with something to ship. A download and an
         * appointment have no destination, and a shipping address on a
         * membership is a claim about the world that isn't true.
         */
        ...(shipping ? { shipping } : {}),
        /*
         * Sailo's cut, named on the charge itself.
         *
         * It has to be here and not in the Dashboard's platform pricing
         * scheme: that scheme only applies where the platform is billed for
         * Stripe's own fees, which is not this configuration. Measured against
         * a sandbox — a direct charge with no `application_fee_amount` comes
         * back with `application_fee_amount: null` however the Dashboard is
         * set. A fee that lives in code is also one that shows up in a diff.
         */
        // Rounded like every other amount here: Stripe rejects a
        // three-decimal currency amount that is not a multiple of ten, and it
        // would reject this one after accepting all the line items.
        ...(applicationFee > 0
          ? { application_fee_amount: toStripeAmount(applicationFee, currency) }
          : {}),
      },
      // Adaptive Pricing would let the buyer pay a converted amount in their
      // own currency. The shop picked its currency, the order row records it,
      // and the invoice states it — letting Stripe charge a different one
      // means our books and the seller's payout disagree.
      adaptive_pricing: { enabled: false },
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
    },
    actingAs(shop.stripeAccountId),
  );
}

/** Refunds a card order in Stripe. Manual rails are settled off-platform. */
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
