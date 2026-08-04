import "server-only";
import type Stripe from "stripe";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orderItems, shops, type Order, type Shop } from "@/db/schema";
import { appUrl, stripe } from "@/lib/stripe";

/**
 * Card payments through the seller's own Stripe account, using Connect.
 *
 * Express accounts: Stripe hosts the onboarding and the payouts dashboard, so
 * Sailo never sees bank details, never holds funds, and never stores anyone's
 * API keys — we hold an account id and act on their behalf with it.
 *
 * No application fee is taken anywhere in this file. The plan copy promises
 * Sailo takes no cut of sales, and that promise lives here.
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
    const account = await stripe().accounts.create({
      type: "express",
      email: shop.contactEmail ?? undefined,
      business_profile: {
        name: shop.name,
        url: `${appUrl()}/${shop.handle}`,
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
function actingAs(accountId: string): { stripeAccount?: string } {
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
   * The basket, so Stripe's receipt itemises what was bought. Optional only as
   * an optimisation — omit it and the lines are read from the order.
   */
  items?: { name: string; unitPriceCents: number; quantity: number }[];
  /** Where to send the buyer afterwards. */
  successUrl: string;
  cancelUrl: string;
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
  const goods =
    opts.items?.length
      ? opts.items
      : await (async () => {
          const rows = await getDb().query.orderItems.findMany({
            where: eq(orderItems.orderId, order.id),
            orderBy: [asc(orderItems.position)],
          });

          if (rows.length > 0) {
            return rows.map((r) => ({
              name: r.variantLabel ? `${r.title} — ${r.variantLabel}` : r.title,
              unitPriceCents: r.unitPriceCents,
              quantity: r.quantity,
            }));
          }

          // Genuinely single-line: an order written before carts existed.
          return [
            {
              name: order.variantLabel
                ? `${order.productTitle} — ${order.variantLabel}`
                : order.productTitle,
              unitPriceCents: order.unitPriceCents,
              quantity: order.quantity,
            },
          ];
        })();

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

  // The goods, at the unit price actually charged. Quantity is a separate
  // field so Stripe's receipt reads "3 × Speckled Mug" rather than one lump.
  for (const [index, item] of goods.entries()) {
    line_items.push({
      quantity: item.quantity,
      price_data: {
        currency,
        unit_amount: item.unitPriceCents,
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
        unit_amount: order.deliveryFeeCents,
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
        unit_amount: order.taxCents,
        product_data: { name: order.taxName ?? "Tax" },
      },
    });
  }

  // A coupon is applied as a Stripe discount so the buyer sees the reduction
  // on Stripe's page rather than a total that silently disagrees with ours.
  let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
  if (order.discountCents > 0) {
    const coupon = await stripe().coupons.create(
      {
        amount_off: order.discountCents,
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
      metadata: { orderId: order.id, shopId: shop.id },
      payment_intent_data: {
        metadata: { orderId: order.id, shopId: shop.id },
        description: `${shop.name} — ${order.productTitle}`,
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
    },
    actingAs(opts.accountId),
  );
}
