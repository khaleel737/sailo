import "server-only";
import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, shops } from "@/db/schema";
import { revalidateShop } from "@/lib/cache";
import { abandonOrder, restoreStock } from "@/lib/inventory";
import { releaseDownloads } from "@/lib/downloads";
import { createInvoiceForOrder } from "@/lib/invoices";
import { confirmBuyerByEmail } from "@/lib/orders/confirm-buyer";
import { intentIdOf, orderForIntent, orderForSession } from "./ownership";

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
            updatedAt: new Date(),
          })
          // Only ever a promotion from `unpaid`; a later event that already
          // settled this order must not be walked backwards by a retry.
          .where(and(eq(orders.id, order.id), eq(orders.paymentStatus, "unpaid")));

        return `awaiting settlement (${session.payment_status})`;
      }

      // Payment is what confirms the order, so the seller never has to.
      await db
        .update(orders)
        .set({
          paymentStatus: "paid",
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
              unlockNow: Boolean(order.downloadToken),
              downloadToken: order.downloadToken,
            },
            base: process.env.NEXT_PUBLIC_APP_URL ?? "",
          });
        }
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

      return `order ${order.id} expired and restocked`;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const order = await orderForIntent(charge.payment_intent, accountId);
      if (!order) return "order not found";

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

      return `order ${order.id} refunded`;
    }

    /*
     * A buyer told their bank the charge was wrong.
     *
     * Stripe pulls the money out of the seller's balance the moment this
     * arrives — before anyone decides who is right — so the order has to stop
     * reading as a completed sale immediately. `disputed` is not a payment
     * status the seller can set; it is a fact reported to us.
     */
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const order = await orderForIntent(dispute.payment_intent, accountId);
      if (!order) return "order not found";

      await db
        .update(orders)
        .set({
          paymentStatus: "disputed",
          refundReason: `Chargeback: ${dispute.reason}`,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      return `order ${order.id} disputed (${dispute.reason})`;
    }

    /*
     * The bank decided. `won` gives the money back and the sale stands; `lost`
     * makes the withdrawal permanent, which is a refund the seller never chose
     * — so the goods go back on the shelf exactly as a refund would put them.
     */
    case "charge.dispute.closed": {
      const dispute = event.data.object as Stripe.Dispute;
      const order = await orderForIntent(dispute.payment_intent, accountId);
      if (!order) return "order not found";

      const won = dispute.status === "won";
      if (won) {
        await db
          .update(orders)
          .set({
            paymentStatus: "paid",
            refundReason: null,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id));
        return `order ${order.id} dispute won`;
      }

      // Lost, or withdrawn in the buyer's favour: treat it as money gone.
      await restoreStock(order);
      await db
        .update(orders)
        .set({
          paymentStatus: "refunded",
          status: "refunded",
          refundedCents: dispute.amount,
          refundedAt: new Date(),
          refundReason: `Chargeback lost: ${dispute.reason}`,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      return `order ${order.id} dispute ${dispute.status}`;
    }

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
      for (const row of synced) revalidateShop(row.id, row.handle);
      return `account ${account.id} synced`;
    }

    default:
      return `ignored ${event.type}`;
  }
}
