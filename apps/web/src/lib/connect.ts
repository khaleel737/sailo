import "server-only";
import { toStripeAmount } from "@/lib/currency";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shops, type Order, type Shop } from "@/db/schema";
import { lineTitle, orderLines, orderSummaryTitle } from "@/lib/order-lines";
import { stripe } from "@/lib/stripe";
import { appUrl } from "@/lib/app-url";
import { taxName } from "@/lib/tax-label";
import { platformFeeCents } from "@/lib/plans";

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
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { shopId: shop.id, handle: shop.handle },
    });
    accountId = account.id;

    await db
      .update(shops)
      .set({ ...accountFields(account), stripeConnectedAt: new Date(), updatedAt: new Date() })
      .where(eq(shops.id, shop.id));
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
