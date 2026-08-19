import "server-only";
import type Stripe from "stripe";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, shops } from "@sailo/db/schema";
import { revalidateShop } from "@/lib/cache";
import { publishAffiliateEvent, publishShopEvent } from "@sailo/events";
import { abandonOrder } from "@sailo/commerce/catalog";
import { releaseDownloads } from "@/lib/downloads";
import { createInvoiceForOrder } from "@/lib/invoices";
import { confirmBuyerByEmail } from "@sailo/workflows/orders";
import { notifySellerOfOrder } from "@sailo/workflows/orders";
import { emitOrderWebhook } from "@sailo/webhooks/emit";
import { announceOrderPaid } from "@sailo/workflows/orders";
import { intentIdOf, orderForIntent, orderForSession } from "@sailo/payments";
import { taxFromSession } from "@sailo/payments/tax";
import { presentmentFromSession } from "@sailo/payments/presentment";
import { handleSubscriptionRefund } from "./platform";
import { handleDisputeEvent, handleEarlyFraudWarning } from "./disputes";
import {
  handleMembershipInvoiceFailed,
  handleMembershipInvoicePaid,
  handleSubscriptionChanged,
  handleSubscriptionCheckout,
  handleSubscriptionDeleted,
} from "./memberships";

/**
 * A buyer's payment on a seller's connected account.
 *
 * The order is found by session id, then by the order id we put in metadata —
 * the second is a fallback for the case where the session id write lost a race
 * with a very fast webhook.
 */
export async function handleConnectEvent(event: Stripe.Event, accountId: string | null) {
  const db = getDb();

  switch (event.type) {
    /*
     * A card session completes already paid. A delayed method — iDEAL, SEPA,
     * Bancontact — completes unpaid and settles later, which is what the
     * `async_payment_*` events report, so all three land here.
     */
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;

      /*
       * A membership checkout is a different animal and forks here.
       *
       * Everything below this line assumes a payment: it marks the order paid,
       * issues an invoice against money that has arrived, and emails the buyer
       * a receipt. A subscription session has taken nothing yet — on a trial it
       * will take nothing for a fortnight — so running that path would confirm
       * an order nobody has paid for and claim an invoice number for it.
       */
      if (session.mode === "subscription") {
        return handleSubscriptionCheckout(session, accountId);
      }

      const order = await orderForSession(session, accountId);
      if (!order) return "order not found";

      /*
       * A session that needed no money is settled, not in flight.
       *
       * Stripe reports `no_payment_required` when the total is zero, which a
       * 100%-off coupon on a basket with no delivery fee produces — and
       * `connect.ts` applies coupons as Stripe discounts, so it really does
       * happen. Treating every non-`paid` status as "still settling" stranded
       * those orders in `pending` forever: no `async_payment_*` event ever
       * follows, because nothing is settling. The order was never confirmed,
       * its downloads never released, and — since the sweep skips `pending` —
       * its stock never reclaimed either.
       */
      const settled =
        session.payment_status === "paid" ||
        session.payment_status === "no_payment_required";

      /*
       * What the buyer's statement will say, when Stripe converted it.
       *
       * Null whenever they paid in the shop's own currency, which is the
       * ordinary case and every order written before Adaptive Pricing was
       * switched on. Spread rather than assigned so that null writes nothing
       * at all — a retry of an event that arrived before the conversion was
       * known must not blank a value a later event already recorded.
       */
      const presentment = presentmentFromSession(session);

      if (!settled) {
        /*
         * Not a failure: the money is still in flight and Stripe will tell us
         * how it lands. Boleto takes up to three days, SEPA longer.
         *
         * This used to write nothing and return, which left the order sitting
         * at `unpaid` — indistinguishable from a buyer who opened a checkout
         * and wandered off. `releaseAbandonedCheckouts` sweeps exactly that
         * shape at 24 hours, so a Boleto buyer's order was cancelled and their
         * goods put back on the shelf while their money was still on its way.
         *
         * `pending` is the status that already means "we are waiting for money
         * we expect", so the sweep passes over it and the seller sees the
         * truth rather than an order that looks abandoned.
         */
        await db
          .update(orders)
          .set({
            paymentStatus: "pending",
            stripePaymentIntentId: intentIdOf(session.payment_intent),
            stripeAccountId: accountId ?? order.stripeAccountId,
            /*
             * Recorded here and not only on the paid path, because this branch
             * is where the converted payments actually arrive. iDEAL and SEPA
             * are delayed-notification rails, and they are precisely the ones
             * Adaptive Pricing exists to unlock — so the buyer who most needs
             * their statement explained is the one whose order sits in
             * `pending` for a day first.
             */
            ...presentment,
            updatedAt: new Date(),
          })
          // Only ever a promotion from `unpaid`; a later event that already
          // settled this order must not be walked backwards by a retry.
          .where(and(eq(orders.id, order.id), eq(orders.paymentStatus, "unpaid")));

        // The seller's panel now has a payment to watch; tell it so. Every
        // publish in this file is a hint for open dashboards — a buyer's
        // money is never contingent on one, which is why none is awaited
        // into a position where it could matter. They cannot throw.
        await publishShopEvent(order.shopId, "payment");
        return `awaiting settlement (${session.payment_status})`;
      }

      /*
       * What Stripe Tax actually charged, before anything reads the order.
       *
       * Under `automatic_tax` the order this handler is about was written with
       * `taxCents: 0` — deliberately, because at checkout no address had been
       * collected and no rate could be chosen. These are the real figures, and
       * they have to land now: `createInvoiceForOrder` runs a few lines below,
       * and an invoice issued from the pre-settlement row would state a tax of
       * zero beside a card statement that says otherwise.
       *
       * Null for every manual-mode order — Stripe computed nothing, so there is
       * nothing to write and the shop's own snapshot stands untouched.
       */
      const settledTax = taxFromSession(session);

      /*
       * The settlement, in two writes: the claim, then the figures.
       *
       * `order.paymentStatus !== "paid"` on the row read at the top of this
       * handler is a check-then-act, not a claim. Two settling events for one
       * session carry two event ids, so the route's own event-id claim does not
       * fence them, and both read `unpaid` before either writes — so both mailed
       * the seller, both emitted `order.created` and `order.paid`, and both sent
       * the buyer a receipt with an invoice link. A buyer holding two receipts
       * for one order cannot tell whether they were charged twice.
       *
       * Moving the status into the WHERE makes it a claim: exactly one caller's
       * UPDATE matches a row, and `returning` tells that caller it won.
       *
       * Split from the figures below rather than merged with them, because the
       * two want opposite things. The claim must match once. The figures must
       * land whichever delivery carried them — a session whose `payment_intent`
       * or Stripe Tax totals only appear on the second event would otherwise be
       * settled with the first one's blanks, permanently.
       */
      const settleClaim = await db
        .update(orders)
        .set({ paymentStatus: "paid", updatedAt: new Date() })
        .where(and(eq(orders.id, order.id), ne(orders.paymentStatus, "paid")))
        .returning({ id: orders.id });

      /** Whether this delivery is the one that moved the order to paid. */
      const settledHere = settleClaim.length > 0;

      // Payment is what confirms the order, so the seller never has to.
      await db
        .update(orders)
        .set({
          ...presentment,
          ...(settledTax
            ? {
                taxCents: settledTax.taxCents,
                totalCents: settledTax.totalCents,
                taxRateBp: settledTax.taxRateBp,
                buyerTaxId: settledTax.buyerTaxId,
                buyerTaxIdType: settledTax.buyerTaxIdType,
                taxReverseCharge: settledTax.reverseCharge,
              }
            : {}),
          /*
           * Payment confirms an order, but it does not confirm an appointment.
           *
           * A booked order carries a time the buyer *asked* for, and the
           * checkout tells them so: "the shop confirms your slot after you
           * order". Flipping it to `confirmed` here made that a lie — the
           * buyer read "confirmed" about a time nobody had agreed to, and the
           * seller was never asked. A booking stays `new` until they accept
           * it; everything else still confirms itself, so the seller never has
           * to touch an ordinary order.
           */
          status:
            order.status === "new" && !order.scheduledFor
              ? "confirmed"
              : order.status,
          stripePaymentIntentId: intentIdOf(session.payment_intent),
          stripeAccountId: accountId ?? order.stripeAccountId,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      /*
       * A digital order is only delivered once the money is confirmed, and for
       * a card sale this webhook *is* that confirmation. Without this the buyer
       * pays and gets nothing until the seller notices and flips the payment
       * status by hand — the one path that did call this.
       *
       * Idempotent: it claims `downloadReleasedAt` in its own WHERE clause, so
       * a redelivery sends one email, not two.
       */
      await releaseDownloads(order.id);

      /*
       * The invoice and the buyer's confirmation, issued where the money is.
       *
       * Both used to run at checkout, which on the card rail is before the
       * buyer has paid: an abandoned session left a claimed invoice number
       * gapping a sequence a tax authority expects unbroken, and an
       * un-recallable "we have your order" for an order the sweep then
       * cancelled. Every other rail still issues them at checkout, because on
       * those the order *is* the commitment and no webhook is coming.
       *
       * The token was minted before the session so the success URL could name
       * it, and travels in the session's metadata — so the link the buyer was
       * handed resolves to the invoice created here. `createInvoiceForOrder`
       * is keyed on the order, so a redelivery returns the existing one rather
       * than claiming a second number.
       */
      const paidShop = await db.query.shops.findFirst({
        where: eq(shops.id, order.shopId),
      });
      if (paidShop) {
        const invoice = await createInvoiceForOrder(
          order.shopId,
          order.id,
          session.metadata?.invoiceToken || undefined,
        );

        if (order.customerEmail && !order.confirmationSentAt) {
          await confirmBuyerByEmail({
            shop: paidShop,
            orderId: order.id,
            invoice,
            delivery: {
              deliversFiles: Boolean(order.downloadToken),
              deliversAccess: Boolean(order.downloadToken),
              unlockNow: Boolean(order.downloadToken),
              downloadToken: order.downloadToken,
            },
            base: process.env.NEXT_PUBLIC_APP_URL ?? "",
          });
        }

        /*
         * The seller's copy — the card rail's half of the "exactly one of the
         * two sites fires per order" rule; `createOrderIntent` covers every
         * rail that settles at checkout. Replays of *this* event are fenced by
         * the event-id claim in the webhook route, and the pre-update status
         * read fences the rarer case of a second settling event for an order
         * already marked paid. Best-effort: it logs its own failures and never
         * throws, so a mail outage cannot make Stripe retry a settled payment.
         */
        if (settledHere) {
          await notifySellerOfOrder({ shop: paidShop, orderId: order.id });

          /*
           * The card rail's `order.created`, and its `order.paid`, together.
           *
           * `createOrderIntent` deliberately emits neither for this rail: the
           * order it wrote was a Stripe session the buyer had not paid, and a
           * third of those are abandoned and swept. This is the moment the
           * order becomes real, so both events belong here — a consumer
           * subscribed to `order.created` then sees one event per real order
           * whichever way the shop takes money, and one subscribed to both
           * sees them arrive together, which is the truth about a card sale.
           *
           * Guarded by the same settlement claim as the mail above, so a
           * second settling event for an order already marked paid adds
           * nothing. Awaited rather than deferred: this is a webhook handler,
           * not a request somebody is waiting on, and `after()` here would race
           * the function shutting down.
           */
          await emitOrderWebhook({
            shop: paidShop,
            event: "order.created",
            orderId: order.id,
          });
          /*
           * One call, not two. The webhook and spec 30's `product.purchased`
           * enrolment are the same announcement made to two audiences, and
           * the seller's own "mark as paid" makes it too — a second copy is
           * the "guard at one sink and not its twin" shape, on a path where
           * the symptom is a flow that runs for one rail and not the other.
           */
          await announceOrderPaid({ shop: paidShop, orderId: order.id });
        }
      }

      await publishShopEvent(order.shopId, "order");
      // A settled sale is also the moment an affiliate's commission becomes
      // real on their portal.
      if (order.affiliateId) {
        await publishAffiliateEvent(order.affiliateId, "order");
      }
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
    /*
     * A delayed payment that failed to settle — the buyer's bank refused it
     * days after checkout. Same consequence as an abandoned basket: the units
     * were reserved when the order was written and have to go back.
     */
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const order = await orderForSession(session, accountId);
      if (!order) return "order not found";
      if (order.paymentStatus === "paid") return "already paid";

      await abandonOrder(order);
      await db
        .update(orders)
        .set({
          status: "cancelled",
          paymentStatus: "unpaid",
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      await publishShopEvent(order.shopId, "order");
      return `order ${order.id} failed to settle and was restocked`;
    }

    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const order = await db.query.orders.findFirst({
        where: eq(orders.stripeSessionId, session.id),
      });
      if (!order) return "order not found";
      if (order.paymentStatus === "paid") return "already paid";

      await abandonOrder(order);
      await db
        .update(orders)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(orders.id, order.id));

      await publishShopEvent(order.shopId, "order");
      return `order ${order.id} expired and restocked`;
    }

    /*
     * The member's standing arrangement, as Stripe sees it.
     *
     * These arrive on the *connected* account, which is what separates them
     * from their identically-named siblings in `platform.ts`: those are a
     * seller paying Sailo, these are a buyer paying a seller. Two endpoints,
     * two signing secrets, two meanings — and the only reason they can share
     * a name safely is that neither handler is ever reached by the other's
     * events.
     */
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return handleSubscriptionChanged(
        event.data.object as Stripe.Subscription,
        accountId,
      );

    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(
        event.data.object as Stripe.Subscription,
        accountId,
      );

    /*
     * The money, which for a subscription arrives here rather than on the
     * session — once at signup and again on every renewal for as long as the
     * member stays. This is what writes the order that keeps Income truthful.
     */
    case "invoice.paid":
      return handleMembershipInvoicePaid(
        event.data.object as Stripe.Invoice,
        accountId,
      );

    case "invoice.payment_failed":
      return handleMembershipInvoiceFailed(
        event.data.object as Stripe.Invoice,
        accountId,
      );

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const order = await orderForIntent(charge.payment_intent, accountId);
      if (!order) {
        /*
         * No order on this charge. With no connected account behind it either,
         * the refund is not a buyer being repaid at all — it is Sailo handing
         * a seller their own subscription money back, which arrives here only
         * because a platform `charge.refunded` is indistinguishable from a
         * direct-charge seller's until the order lookup above comes back
         * empty. Handing it on is the whole of this branch; the platform side
         * owns what happens next.
         */
        if (!accountId) return handleSubscriptionRefund(charge);
        return "order not found";
      }

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

      await publishShopEvent(order.shopId, "payment");
      // The commission this order carried just changed shape too.
      if (order.affiliateId) {
        await publishAffiliateEvent(order.affiliateId, "payment");
      }
      return `order ${order.id} refunded`;
    }

    /*
     * A buyer told their bank the charge was wrong.
     *
     * All five dispute events now go to one handler in `disputes.ts`, and the
     * two cases that used to sit here were wrong in ways that each cost money:
     *
     * - `created` fires for *inquiries* as well as chargebacks, and an inquiry
     *   moves nothing. Verified in test mode: `balance_transactions: []`,
     *   `is_charge_refundable: true`. The old code marked the order `disputed`
     *   for both, telling a seller their money had gone when it had not — in a
     *   status `SELLER_SETTABLE_PAYMENT_STATUSES` forbids them from correcting.
     *
     * - `closed` branched on `status === "won"`, so `warning_closed` — an
     *   inquiry that closed with no chargeback behind it, which is the *good*
     *   outcome — took the losing side: the order was marked refunded, its stock
     *   went back on the shelf and the affiliate's commission was reversed, on a
     *   sale the seller had been paid for and still held.
     *
     * The handler also records the dispute, its deduction and its deadline, and
     * reassesses the shop — none of which happened here.
     */
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
    case "charge.dispute.funds_withdrawn":
    case "charge.dispute.funds_reinstated":
      return handleDisputeEvent(event, accountId);

    /*
     * The only advance notice of a chargeback anybody gets. Recorded and
     * surfaced, never acted on automatically — see `handleEarlyFraudWarning`.
     */
    case "radar.early_fraud_warning.created":
      return handleEarlyFraudWarning(event, accountId);

    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      // Stripe can enable or restrict an account at any time; mirroring it
      // keeps the card button off the storefront while a seller is blocked.
      const synced = await db
        .update(shops)
        .set({
          stripeChargesEnabled: Boolean(account.charges_enabled),
          stripeDetailsSubmitted: Boolean(account.details_submitted),
          updatedAt: new Date(),
        })
        .where(eq(shops.stripeAccountId, account.id))
        .returning({ id: shops.id, handle: shops.handle });

      // Whether the card button may be shown is cached; a restriction that the
      // storefront never hears about is the same as no restriction.
      for (const row of synced) {
        revalidateShop(row.id, row.handle);
        // The payments page shows exactly these two flags.
        await publishShopEvent(row.id, "account");
      }
      return `account ${account.id} synced`;
    }

    default:
      return `ignored ${event.type}`;
  }
}
