import "server-only";
import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, shops, stripeEvents } from "@/db/schema";
import { stripe } from "@/lib/stripe";
import { abandonOrder, restoreStock } from "@/lib/inventory";
import { releaseDownloads } from "@/lib/downloads";
import { createInvoiceForOrder } from "@/lib/invoices";
import { confirmBuyerByEmail } from "@/lib/orders/confirm-buyer";
import { freePlanFields, subscriptionFields } from "@/lib/billing-map";

/**
 * Everything both Stripe webhook routes need.
 *
 * There are two endpoints because Stripe has two delivery channels and will not
 * mix them: events about Sailo's own account (a seller paying us) go to a plain
 * endpoint, and events from connected accounts (a buyer paying a seller) go to
 * one registered for Connect. They sign with different secrets, which is why
 * they cannot share a route — but everything after the signature is the same
 * code, and it lives here rather than in two copies that drift.
 */

/** Events we act on. Anything else is acknowledged and ignored. */
export const HANDLED = new Set([
  "checkout.session.completed",
  /*
   * Delayed-notification methods — iDEAL, SEPA, Bancontact, Boleto and the
   * rest. Their session completes with `payment_status: "unpaid"` and the money
   * is confirmed minutes to days later by one of these. Without them a buyer
   * pays by any non-card European or Asian method and the order never leaves
   * "unpaid".
   */
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "charge.refunded",
  "checkout.session.expired",
  "account.updated",
  // Chargebacks. A buyer disputing a card payment takes the money straight
  // back out of the seller's balance, and nothing else tells us it happened.
  "charge.dispute.created",
  "charge.dispute.closed",
]);

/**
 * The signing secrets a route will accept, comma separated.
 *
 * A list rather than one string so a deployment can rotate a secret without a
 * window where half the deliveries fail, and so both endpoints can be pointed
 * at one URL if someone ever wants that.
 */
export function signingSecrets(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);
}

/**
 * Verifies a delivery against each configured secret in turn.
 *
 * Three outcomes, not two. A *thin* payload is the third: Stripe's v2 event
 * destinations send a notification with no `data.object`, and
 * `constructEvent` refuses it outright. That is not a forged request and must
 * not be answered with a 400 — Stripe would retry it forever and eventually
 * disable the destination, taking the working payments down with it. It is
 * simply a format this integration does not consume, so it is verified with
 * the right parser and acknowledged.
 */
export function verifyEvent(
  payload: string,
  signature: string,
  secrets: string[],
):
  | { event: Stripe.Event }
  | { thin: true; type: string }
  | { error: string } {
  let lastError = "no signing secret matched";

  for (const secret of secrets) {
    try {
      return {
        event: stripe().webhooks.constructEvent(payload, signature, secret),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown";
    }
  }

  // Only after every secret has failed the snapshot parser: a thin payload
  // fails it for the shape, not the signature, so try the v2 parser too.
  for (const secret of secrets) {
    try {
      const notification = stripe().parseEventNotification(
        payload,
        signature,
        secret,
      );
      return { thin: true, type: notification.type };
    } catch {
      // Not a thin event either; fall through to the original error.
    }
  }

  return { error: lastError };
}

/**
 * Records the event id, returning false if it has been seen before.
 *
 * The empty result *is* the signal — `onConflictDoNothing` returns no rows
 * precisely when this event is a replay. Stripe delivers at least once, so this
 * runs constantly and must never throw: a non-2xx makes Stripe retry the same
 * event for three days and can get the endpoint disabled.
 */
export async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const [claimed] = await getDb()
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing({ target: stripeEvents.id })
    .returning({ id: stripeEvents.id });
  return Boolean(claimed);
}

/** Lets Stripe's retry have another go at an event whose handler threw. */
export async function releaseEvent(eventId: string) {
  await getDb().delete(stripeEvents).where(eq(stripeEvents.id, eventId));
}

async function shopIdFor(opts: {
  shopId?: string | null;
  customerId?: string | null;
}) {
  const db = getDb();
  if (opts.shopId) {
    const byId = await db.query.shops.findFirst({
      where: eq(shops.id, opts.shopId),
      columns: { id: true },
    });
    if (byId) return byId.id;
  }
  if (opts.customerId) {
    const byCustomer = await db.query.shops.findFirst({
      where: eq(shops.stripeCustomerId, opts.customerId),
      columns: { id: true },
    });
    if (byCustomer) return byCustomer.id;
  }
  return null;
}


/**
 * The account an event arrived on.
 *
 * Stripe omits `account` for events on the platform's own account, and that
 * account is a real seller here: `actingAs` in `lib/connect.ts` deliberately
 * drops the `stripeAccount` header when a shop is wired to the platform's own
 * account, so its charges are created — and its events delivered — with no
 * account named. Resolving null to the platform id keeps that one shop subject
 * to the same ownership rule as every other, rather than exempt from it.
 */
export function sendingAccount(accountId: string | null): string | null {
  return accountId ?? process.env.STRIPE_PLATFORM_ACCOUNT_ID ?? null;
}

/**
 * Whether an event from `sender` may act on an order owned by `owner`.
 *
 * Unknown on either side denies. A shop with no connected account has no
 * charges for an event to be about, and a sender we cannot identify has proved
 * nothing — neither is a reason to fall through to "allow".
 */
export function sameAccount(owner: string | null, sender: string | null): boolean {
  return Boolean(owner && sender && owner === sender);
}

/** A charge's, dispute's or session's payment intent, expanded or not. */
export function intentIdOf(
  intent: string | { id: string } | null | undefined,
): string | null {
  if (!intent) return null;
  return typeof intent === "string" ? intent : intent.id;
}

/**
 * Narrows an order to the account the event arrived on, or to nothing.
 *
 * Every seller on Sailo controls their own Stripe account, so an event naming
 * an order is not evidence that the order's seller sent it.
 */
async function ownedBySender<T extends { shopId: string; stripeAccountId?: string | null }>(
  order: T | undefined,
  accountId: string | null,
): Promise<T | null> {
  if (!order) return null;

  /*
   * The account the charge was actually made on, when the order recorded one.
   *
   * `orders.stripeAccountId` is written at handoff and never changes, which is
   * what makes it the right authority. Resolving ownership through the live
   * `shops` row instead meant that disconnecting Stripe — or Stripe
   * deauthorizing the account — detached every historical order from its own
   * webhooks: a chargeback on last month's sale arrived on the old account,
   * failed to match the shop's new (or null) one, and was dropped. The order
   * kept reading as a completed sale while the money had already left.
   *
   * The shop is still the fallback for orders written before that column was
   * populated, and for rails that never touch Connect.
   */
  const owner =
    order.stripeAccountId ??
    (
      await getDb().query.shops.findFirst({
        where: eq(shops.id, order.shopId),
        columns: { stripeAccountId: true },
      })
    )?.stripeAccountId ??
    null;

  return sameAccount(owner, sendingAccount(accountId)) ? order : null;
}

/**
 * The order behind a payment intent, scoped to the sending account.
 *
 * The only route from a charge or a dispute to an order. `charge.refunded`
 * used to look the intent up itself and skip the scoping every sibling
 * handler applies, which let a seller mark another shop's order refunded — and
 * clear its own chargeback — from their own connected account. A test asserts
 * this stays the only place `stripePaymentIntentId` is searched on.
 */
export async function orderForIntent(
  intent: string | { id: string } | null | undefined,
  accountId: string | null,
) {
  const intentId = intentIdOf(intent);
  if (!intentId) return null;

  const order = await getDb().query.orders.findFirst({
    where: eq(orders.stripePaymentIntentId, intentId),
  });
  return ownedBySender(order, accountId);
}

/**
 * The order a completed session belongs to — and only if it really belongs to
 * the account that sent the event.
 *
 * The session id is ours: we wrote it when we created the session, and Stripe's
 * ids are globally unique, so a match there is proof enough. The fallback by
 * order id is not. `client_reference_id` is a field the *sending account*
 * controls, and every seller on Sailo controls their own Stripe account — so an
 * unscoped lookup let any seller mark any other seller's order paid by opening a
 * checkout session on their own account with the victim's order id in it. It
 * took three shops in one test to see it.
 */
async function orderForSession(
  session: Stripe.Checkout.Session,
  accountId: string | null,
) {
  const db = getDb();

  if (session.id) {
    const bySession = await db.query.orders.findFirst({
      where: eq(orders.stripeSessionId, session.id),
    });
    if (bySession) return bySession;
  }

  const orderId = session.client_reference_id ?? session.metadata?.orderId;
  if (!orderId) return null;

  const byId = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  return ownedBySender(byId, accountId);
}


/**
 * Sailo's own account: a seller paying us.
 *
 * Nothing here touches an order — these are subscriptions and the invoices
 * behind them. The shop is found by the id we put in metadata, falling back to
 * the Stripe customer, because a subscription created outside our checkout has
 * only the customer to go on.
 */
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
      await db
        .update(shops)
        .set({
          stripeChargesEnabled: Boolean(account.charges_enabled),
          stripeDetailsSubmitted: Boolean(account.details_submitted),
          updatedAt: new Date(),
        })
        .where(eq(shops.stripeAccountId, account.id));
      return `account ${account.id} synced`;
    }

    default:
      return `ignored ${event.type}`;
  }
}
