import "server-only";
import { toStripeAmount } from "@sailo/core/currency";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products, shops, type Order, type Product, type Shop } from "@sailo/db/schema";
import { lineTitle, orderLines, orderSummaryTitle } from "@/lib/order-lines";
import { stripe } from "@/lib/stripe";
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
 */

/** Fields we mirror from Stripe onto the shop. */
export function accountFields(account: Stripe.Account) {
  return {
    stripeAccountId: account.id,
    stripeChargesEnabled: Boolean(account.charges_enabled),
    stripeDetailsSubmitted: Boolean(account.details_submitted),
    stripeAccountCountry: account.country ?? null,
  };
}

export const disconnectedFields = {
  stripeAccountId: null,
  stripeChargesEnabled: false,
  stripeDetailsSubmitted: false,
  stripeAccountCountry: null,
  stripeConnectedAt: null,
};

/**
 * The shop's public address, but only when Stripe will accept it.
 *
 * `business_profile.url` has to be a URL Stripe can actually reach. Anything
 * local — localhost, an IP, a bare hostname, a .local domain — is refused with
 * a flat "Not a valid URL" that names no field, so the first person to press
 * Connect on a dev machine gets a runtime error and no idea which of the eight
 * parameters was wrong. Returning null here means we send a description of the
 * business instead and let Stripe ask the seller for their address during
 * onboarding, which it does anyway.
 */
export function publicShopUrl(handle: string): string | null {
  let url: URL;
  try {
    url = new URL(`${appUrl()}/${handle}`);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    // A bare hostname with no dot can't resolve publicly either.
    !host.includes(".") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.startsWith("[");

  return isLocal ? null : url.toString();
}

/**
 * What a connected account is allowed to take money through.
 *
 * `createCheckoutSession` deliberately does not pin `payment_method_types`, so
 * Stripe decides at runtime which of these to show — from the buyer's country
 * and device and the account's active capabilities. Everything here therefore
 * reaches the checkout with no code behind it beyond this list. Apple Pay and
 * Google Pay need no entry at all; they ride `card_payments`.
 *
 * Deliberately short. Stripe's own guidance: "The capabilities you request for
 * a connected account determine the information you're required to collect for
 * it… Requesting more capabilities means the onboarding flow must verify more
 * information." Every extra line here is another question between a seller and
 * their first sale, so a rail earns its place by being one a small US seller
 * actually gets asked for.
 *
 * Not here on purpose:
 *  - Affirm, Klarna and Afterpay decide eligibility on the account's merchant
 *    category code, and `business_profile` below sets no `mcc`. Requesting
 *    them before that exists buys the onboarding questions and none of the
 *    payments. They also finance a purchase, and nobody finances a $45 cake.
 *  - PayPal and Venmo are not obtainable at all: Stripe lists no US business
 *    location for PayPal, does not support it on direct charges, and does not
 *    offer it to platforms whose connected accounts take payment directly.
 *    Venmo has no Stripe support anywhere. Both ship as manual rails instead —
 *    see `PAYMENT_METHOD_DEFS`.
 */
const BASE_CAPABILITIES = {
  card_payments: { requested: true },
  transfers: { requested: true },
} as const;

export const WALLET_CAPABILITIES = {
  /** Stripe's own wallet. One tap for anyone who has used Link anywhere. */
  link_payments: { requested: true },
  /** US only, USD only, and Stripe simply won't offer it elsewhere. */
  cashapp_payments: { requested: true },
  /** Cheap on larger orders, where card fees start to hurt a small seller. */
  us_bank_account_ach_payments: { requested: true },
} as const;

/**
 * Adds the wallet capabilities to an account, and shrugs if Stripe says no.
 *
 * Separate from account *creation* on purpose, and swallowing its own error on
 * purpose, because these three are country-scoped and Sailo's sellers are not
 * all in those countries. Stripe rejects a capability the account's country
 * cannot have rather than leaving it inactive — so requesting them inside
 * `accounts.create` would mean a seller in a country without Cash App could not
 * open a Stripe account at all, which is a far worse failure than not being
 * offered a wallet they could never use.
 *
 * Idempotent: re-requesting an active capability is a no-op, so this is safe to
 * run on every visit and safe to run over every shop after adding a line above.
 */
export async function requestWalletCapabilities(accountId: string) {
  try {
    return await stripe().accounts.update(accountId, {
      capabilities: WALLET_CAPABILITIES,
    });
  } catch (error) {
    // Not an error the seller can act on, and nothing they were promised.
    console.warn("[sailo] wallet capabilities not available for", accountId, error);
    return null;
  }
}

/**
 * Creates the seller's connected account if they don't have one, then returns
 * a fresh onboarding link.
 *
 * Account links are single-use and expire in minutes, so one is minted per
 * click rather than stored.
 */
export async function startOnboarding(shop: Shop) {
  const db = getDb();
  let accountId = shop.stripeAccountId;

  if (!accountId) {
    const shopUrl = publicShopUrl(shop.handle);

    const account = await stripe().accounts.create({
      type: "express",
      email: shop.contactEmail ?? undefined,
      business_profile: {
        name: shop.name,
        ...(shopUrl
          ? { url: shopUrl }
          : {
              product_description:
                shop.description?.trim().slice(0, 500) ||
                `Products and services sold through ${shop.name}.`,
            }),
      },
      capabilities: BASE_CAPABILITIES,
      metadata: { shopId: shop.id, handle: shop.handle },
    });
    accountId = account.id;

    // After creation, never inside it — see `requestWalletCapabilities`.
    await requestWalletCapabilities(accountId);

    await db
      .update(shops)
      .set({ ...accountFields(account), stripeConnectedAt: new Date(), updatedAt: new Date() })
      .where(eq(shops.id, shop.id));
  } else {
    /*
     * The backfill, at the one moment it is free: a seller who already has an
     * account and has come back to the payments screen. Accounts created
     * before a capability was added never requested it, so without this a
     * shop connected last month keeps offering card alone for ever. Requesting
     * an already-active capability is a no-op, so this is safe every time.
     */
    await requestWalletCapabilities(accountId);
  }

  const link = await stripe().accountLinks.create({
    account: accountId,
    // Refresh is what Stripe calls when the link has expired — it must start
    // the flow again, not dead-end on an error page.
    refresh_url: `${appUrl()}/admin/payments?stripe=refresh`,
    return_url: `${appUrl()}/admin/payments?stripe=return`,
    type: "account_onboarding",
  });

  return link.url;
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
 * The `stripeAccount` header, unless the shop *is* the platform account.
 *
 * A real seller always has a distinct connected account and gets the header —
 * that is what makes the charge land in their balance rather than ours. The
 * exception exists so the platform's own Stripe account can be attached to a
 * shop and exercise the whole flow end to end; Stripe rejects the header when
 * it names the calling account itself.
 */
export function actingAs(accountId: string): { stripeAccount?: string } {
  const platform = process.env.STRIPE_PLATFORM_ACCOUNT_ID;
  return accountId && accountId !== platform ? { stripeAccount: accountId } : {};
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
   * Every line. Required: the order's header columns describe one line, and
   * charging from them billed a four-line basket for its first item.
   */
  items: { name: string; unitPriceCents: number; quantity: number }[];
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
  const goods = opts.items.length
    ? opts.items
    : (await orderLines(order)).map((l) => ({
        name: lineTitle(l),
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

  // The goods, at the unit price actually charged. Quantity is a separate
  // field so Stripe's receipt reads "3 × Speckled Mug" rather than one lump.
  for (const [index, item] of goods.entries()) {
    line_items.push({
      quantity: item.quantity,
      price_data: {
        currency,
        unit_amount: toStripeAmount(item.unitPriceCents, currency),
        product_data: {
          name: item.name,
          // The buyer's note belongs to the order, so it rides on the first
          // line rather than being repeated against every product.
          ...(index === 0 && order.note
            ? { description: order.note.slice(0, 500) }
            : {}),
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
        metadata: { orderId: order.id, shopId: shop.id },
        description: `${shop.name} — ${orderSummaryTitle(order)}`,
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
export async function refundCharge(opts: {
  accountId: string;
  paymentIntentId: string;
  amountCents: number;
}) {
  return stripe().refunds.create(
    {
      payment_intent: opts.paymentIntentId,
      amount: opts.amountCents,
      /*
       * Give our fee back with the money.
       *
       * Without this the seller refunds the buyer in full and is still out
       * Sailo's cut — we would be the only party who profited from a sale that
       * got undone. Stripe returns it in proportion to the amount refunded, so
       * a partial refund returns part of the fee.
       */
      refund_application_fee: true,
    },
    actingAs(opts.accountId),
  );
}

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
export async function membershipPrice(shop: Shop, product: Product): Promise<string> {
  if (!shop.stripeAccountId) throw new Error("Shop has no connected Stripe account");
  if (!product.stripePriceId || priceIsStale(product)) {
    const price = await stripe().prices.create(
      {
        currency: shop.currency.toLowerCase(),
        unit_amount: toStripeAmount(product.priceCents, shop.currency),
        recurring: { interval: intervalOf(product) },
        product_data: { name: product.title },
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
  successUrl: string;
  cancelUrl: string;
}) {
  const { shop, order, product } = opts;
  if (!shop.stripeAccountId) throw new Error("Shop has no connected Stripe account");
  if (!membershipSellable(product)) {
    throw new Error(`Product ${product.id} is not a sellable membership`);
  }

  const price = await membershipPrice(shop, product);
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
export async function billingPortalSession(opts: {
  accountId: string;
  customerId: string;
  returnUrl: string;
}) {
  return stripe().billingPortal.sessions.create(
    { customer: opts.customerId, return_url: opts.returnUrl },
    actingAs(opts.accountId),
  );
}

/**
 * Stops a subscription at the end of the period the member already paid for.
 *
 * Never immediately, and not as a kindness: they have paid for the month, so
 * ending it today would be taking money for access we then withdrew. Stripe
 * reports the change back through `customer.subscription.updated`, which is
 * what actually writes it here — this function's return value is not the
 * source of truth and no caller treats it as one.
 */
export async function cancelSubscriptionAtPeriodEnd(opts: {
  accountId: string;
  subscriptionId: string;
}) {
  return stripe().subscriptions.update(
    opts.subscriptionId,
    { cancel_at_period_end: true },
    actingAs(opts.accountId),
  );
}
