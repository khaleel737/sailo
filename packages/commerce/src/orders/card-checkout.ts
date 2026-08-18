/**
 * One card payment, handed to Stripe.
 *
 * Bills once, from amounts we computed. The two decisions worth finding here are that the
 * platform fee is applied on the seller's own account, and that adaptive pricing is off — the
 * shop picked its currency, the order row records it and the invoice states it, so letting
 * Stripe charge a converted one would put our books and the seller's payout in disagreement.
 *
 * `@sailo/commerce/orders/server` re-exports this folder, so no caller moved.
 */

import "server-only";
import { toStripeAmount } from "@sailo/core/currency";
import { checkoutShipping, type CheckoutLine } from "./checkout-lines";
import { type Order, type Shop } from "@sailo/db/schema";
import { lineTitle, orderSummaryTitle } from "@sailo/core/order-lines";
import { orderLines } from "./order-lines";
import { actingAs, stripe } from "@sailo/payments";
import { taxName } from "@sailo/core/tax-label";
import { platformFeeCents } from "@sailo/core/plans";
import type Stripe from "stripe";

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
  setSubscriptionApplicationFee,
} from "@sailo/payments";

export * from "./connect-account";
export * from "./subscription-checkout";

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
  /*
   * Whether Stripe works the tax out instead of us.
   *
   * On only when the seller has both switched tax on *and* chosen Stripe Tax.
   * A shop on the flat rate keeps the behaviour it has always had, down to the
   * hand-built tax line below, so this is inert for every existing seller.
   */
  const automaticTax = shop.taxEnabled && shop.taxMode === "stripe";

  /*
   * What the price means, which Stripe cannot infer.
   *
   * `exclusive` says the amount is pre-tax and Stripe adds on top; `inclusive`
   * says the tax is already inside it and Stripe extracts it. Getting this
   * wrong does not error — it silently overcharges an EU shop by its own VAT
   * rate or undercharges a US one — so it is stated on every line rather than
   * left to the account default a seller has never seen.
   */
  const taxBehavior = shop.taxInclusive ? "inclusive" : "exclusive";
  const behavior = automaticTax
    ? ({ tax_behavior: taxBehavior } as const)
    : ({} as const);

  for (const item of goods) {
    line_items.push({
      quantity: item.quantity,
      price_data: {
        currency,
        unit_amount: toStripeAmount(item.unitPriceCents, currency),
        ...behavior,
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
        /*
         * Shipping is taxable in most places and Stripe knows where it is not,
         * so the delivery line is handed over with the goods rather than being
         * held back by `shop.taxOnDelivery` — that switch is the seller's own
         * judgement, and under Stripe Tax the whole point is that the judgement
         * is no longer theirs to make.
         */
        ...behavior,
        product_data: { name: order.deliveryLabel ?? "Delivery" },
      },
    });
  }

  /*
   * Exclusive tax is a line the buyer pays on top. Inclusive tax is already
   * inside the unit price and must not be added again.
   *
   * Neither happens under Stripe Tax: `order.taxCents` is 0 there because
   * nothing has been computed yet, and Stripe adds its own tax to the session.
   * A hand-rolled line beside `automatic_tax` would be taxed *by* it — the
   * buyer would pay VAT on the VAT.
   */
  if (!automaticTax && order.taxCents > 0 && !order.taxInclusive) {
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
      /*
       * Let a buyer abroad pay in their own currency.
       *
       * This was off, on the reasoning that a converted charge would put our
       * books and the seller's payout in disagreement. That reasoning was
       * wrong, and it is worth stating why plainly because it reads
       * plausible. Stripe: "The Checkout Session and the underlying
       * PaymentIntent objects reflect what your customer paid in *your
       * integration currency and amount*." `amount_total` and `currency` come
       * back exactly as this function sent them, the payout is in the shop's
       * currency, and the invoice states the shop's currency. Nothing in our
       * books moves. Stripe carries the conversion and reports what the buyer
       * saw separately, as `presentment_details` — which the Connect webhook
       * now records onto the order, because that figure is what a buyer's card
       * statement says and it exists nowhere else.
       *
       * What it buys is the entire local-payment-method question. iDEAL
       * settles in EUR and in nothing else, so a shop priced in dollars could
       * not offer it to a Dutch buyer however many capabilities its account
       * had — and Stripe's own note is that iDEAL is 70% of Dutch
       * e-commerce. Bancontact, BLIK, SEPA Debit and P24 are the same story.
       *
       * Deliberately not set on `subscription-checkout`: Stripe supports only
       * cards and wallets on cross-border subscriptions, so it would buy a
       * member nothing and cost them a currency they did not expect on a
       * charge that repeats. Nor on `@sailo/billing`, where the plan prices
       * are advertised in USD on a page that does not localise — converting
       * those really would contradict what the seller was quoted.
       *
       * Requires the platform switch at
       * dashboard.stripe.com/settings/connect/adaptive-pricing. Without it
       * this parameter is inert rather than an error, and every session simply
       * presents in the shop's currency as before.
       */
      adaptive_pricing: { enabled: true },
      /*
       * Stripe Tax, on the seller's own account.
       *
       * The registrations that decide the rate are theirs — Sailo is never
       * merchant of record on a Sailo sale — so this reads their Tax settings,
       * their origin address and their thresholds, and the liability follows
       * them. A seller who enables the mode without completing Stripe's tax
       * setup gets an error from Stripe at session creation rather than a
       * silently untaxed sale, which is the failure we want.
       */
      ...(automaticTax
        ? {
            automatic_tax: { enabled: true },
            /*
             * Automatic tax needs somewhere to put the buyer. Sailo's own cart
             * collects a delivery address only for things that ship, so a
             * download or an appointment would otherwise reach Stripe with no
             * location at all and no rate could be chosen.
             */
            billing_address_collection: "required" as const,
            /*
             * And a VAT number, when the seller sells B2B.
             *
             * This is what makes the reverse charge possible: Stripe validates
             * the number against VIES, and a valid one in another member state
             * moves the liability to the buyer and zero-rates the sale. Off
             * unless the seller asked for it — an unexplained "Tax ID"
             * field is a checkout step that costs consumer sales.
             */
            ...(shop.taxIdCollection
              ? { tax_id_collection: { enabled: true } }
              : {}),
          }
        : {}),
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
    },
    actingAs(shop.stripeAccountId),
  );
}
