/**
 * A membership invoice paid, or failed.
 *
 * The two events that are about money, and the ones with consequences a member notices: access
 * extends, or it is about to stop.
 */

import "server-only";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, orders, products, subscriptions, type Shop, type Subscription } from "@sailo/db/schema";
import { createInvoiceForOrder } from "@/lib/invoices";
import { downloadUrl } from "@/lib/downloads";
import { publishShopEvent } from "@sailo/events";
import { emitSubscriptionWebhook } from "@sailo/webhooks/emit";
import { notifySellerMembershipPaymentFailed } from "@sailo/workflows/memberships/notify-seller";
import { releaseDownloads } from "@/lib/downloads";
import { sendMembershipPaymentFailed, sendMembershipStarted } from "@/lib/email";
import { sendingAccount } from "@sailo/payments";
import type Stripe from "stripe";
import { subscriptionIdOf } from "./read";
import { TERMINAL, resolveSubscription } from "./upsert";

export async function handleMembershipInvoicePaid(
  invoice: Stripe.Invoice,
  accountId: string | null,
): Promise<string> {
  const db = getDb();

  const subId = subscriptionIdOf(invoice);
  if (!subId) return "invoice is not for a subscription";
  if (invoice.amount_paid <= 0) return "invoice paid nothing";

  const known = await resolveSubscription(subId, accountId);
  if (!known) return "membership invoice: unknown subscription";
  const { shop, row } = known;

  /*
   * The signup's own order, still waiting for its first payment.
   *
   * `payment_status = 'unpaid'` in the WHERE is the claim, and it is what
   * makes a redelivery safe: the first delivery flips it to `paid`, so the
   * second matches nothing and falls through to the renewal path, where the
   * unique index on the invoice id refuses it outright.
   *
   * `stripe_invoice_id is null` is belt to that brace. It costs nothing and
   * it closes the one shape the status alone would not: an order somehow left
   * `unpaid` while already carrying an invoice id would otherwise be handed a
   * second one, and two rows claiming the same invoice is precisely what the
   * index exists to prevent.
   */
  const [firstPayment] = await db
    .update(orders)
    .set({
      paymentStatus: "paid",
      status: "confirmed",
      stripeInvoiceId: invoice.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.subscriptionId, row.id),
        eq(orders.paymentStatus, "unpaid"),
        isNull(orders.stripeInvoiceId),
        eq(orders.shopId, shop.id),
      ),
    )
    .returning();

  const order = firstPayment ?? (await writeRenewalOrder(invoice, shop, row));
  if (!order) return `membership ${row.id}: renewal already recorded`;

  /*
   * The invoice row, and the files if there are any.
   *
   * `createInvoiceForOrder` is keyed on the order, so a redelivery returns the
   * existing one rather than claiming a second number out of a sequence a tax
   * authority expects unbroken.
   */
  await createInvoiceForOrder(shop.id, order.id);
  await releaseDownloads(order.id);

  // The welcome only goes out for the first payment. A renewal is a receipt,
  // and telling somebody "welcome to the gym" every month is how a shop
  // teaches its members to filter its mail.
  if (firstPayment && order.customerEmail) {
    const product = row.productId
      ? await db.query.products.findFirst({ where: eq(products.id, row.productId) })
      : undefined;
    await sendMembershipStarted({
      shop,
      to: order.customerEmail,
      name: order.customerName,
      productTitle: product?.title ?? order.productTitle,
      interval: row.interval,
      priceCents: row.priceCents,
      currency: row.currency,
      /*
       * Their own page, which is where cancelling lives. A membership signup
       * always mints a token for exactly this reason: a member with no way to
       * find the cancel button cancels through their bank instead, and a
       * chargeback costs the seller far more than the month they wanted back.
       */
      manageUrl: order.downloadToken ? downloadUrl(order.downloadToken) : null,
    });
  }

  await publishShopEvent(shop.id, "order");

  /*
   * `subscription.renewed`, and only for a renewal.
   *
   * `firstPayment` is the signup's own order settling, which
   * `subscription.created` has already announced — emitting a renewal for it
   * would tell a consumer that a member who joined this morning has completed a
   * billing cycle. The `order.paid` event fires for both regardless, so the
   * money is never silent either way.
   */
  if (!firstPayment) {
    await emitSubscriptionWebhook({
      shop,
      event: "subscription.renewed",
      subscriptionId: row.id,
    });
  }

  return `membership ${row.id} paid ${invoice.amount_paid}`;
}

/**
 * A renewal, as an ordinary order.
 *
 * Everything about stock, delivery, booking and tickets is deliberately absent:
 * a renewal sells no unit, ships nothing and books no slot. What it must do is
 * appear in the seller's Income exactly like a sale, because it is one.
 *
 * Returns null when the unique index refuses it — which is the point of that
 * index. `stripeEvents` de-duplicates whole events but not the same invoice
 * arriving under two event ids, and a renewal recorded twice is a month of
 * revenue that is simply wrong.
 */
export async function writeRenewalOrder(
  invoice: Stripe.Invoice,
  shop: Shop,
  row: Subscription,
) {
  const db = getDb();

  const client = row.clientId
    ? await db.query.clients.findFirst({ where: eq(clients.id, row.clientId) })
    : undefined;
  const product = row.productId
    ? await db.query.products.findFirst({ where: eq(products.id, row.productId) })
    : undefined;

  const title = product?.title ?? "Membership";
  const amount = invoice.amount_paid;

  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      productId: row.productId,
      clientId: row.clientId,
      subscriptionId: row.id,
      stripeInvoiceId: invoice.id,
      stripeAccountId: sendingAccount(row.stripeAccountId),

      productTitle: title,
      productKind: "membership",
      unitPriceCents: amount,
      quantity: 1,
      itemCount: 1,
      currency: (invoice.currency ?? shop.currency).toUpperCase(),

      subtotalCents: amount,
      totalCents: amount,

      customerName: client?.name ?? "Member",
      customerEmail: client?.email ?? invoice.customer_email ?? null,
      customerPhone: client?.phone ?? null,

      paymentMethod: "card",
      paymentStatus: "paid",
      status: "confirmed",
    })
    /*
     * The unique index on `stripe_invoice_id` is what makes this safe, and
     * `onConflictDoNothing` is what turns its refusal into an ordinary
     * "already done" instead of a 500 that makes Stripe retry for three days.
     *
     * The `where` repeats the index's own predicate, and it is not optional:
     * the index is partial — the overwhelming majority of orders are not
     * renewals and index nothing — and Postgres will not infer a partial index
     * from a bare column list. Without it every renewal raised
     * `42P10: there is no unique or exclusion constraint matching the ON
     * CONFLICT specification`, which is to say every renewal failed outright.
     *
     * `where` and not `targetWhere`: on `onConflictDoNothing` the former *is*
     * the index predicate, emitted between the target and `do nothing`. Only
     * `onConflictDoUpdate` splits the two, and copying its spelling here
     * compiles to nothing at all.
     */
    .onConflictDoNothing({
      target: orders.stripeInvoiceId,
      where: sql`${orders.stripeInvoiceId} is not null`,
    })
    .returning();

  return order ?? null;
}

/**
 * The card failed.
 *
 * Status only — access is *not* revoked here, and that is the deliberate part.
 * Stripe retries a failed card for days under its own smart-retry schedule,
 * and a gym that locks the door the morning a card expires has punished a
 * member for their bank's fraud check while its own dunning email is still in
 * flight. `membershipAccess` holds the line instead, on the period the member
 * actually paid for.
 */
export async function handleMembershipInvoiceFailed(
  invoice: Stripe.Invoice,
  accountId: string | null,
): Promise<string> {
  const db = getDb();

  const subId = subscriptionIdOf(invoice);
  if (!subId) return "invoice is not for a subscription";

  const known = await resolveSubscription(subId, accountId);
  if (!known) return "membership invoice failed: unknown subscription";
  const { shop, row } = known;

  /*
   * Compare-and-set, not a bare write. `invoice.payment_failed` can be
   * redelivered or arrive out of order after Stripe has already exhausted
   * dunning and cancelled — and walking a `canceled`/`unpaid` row back to
   * `past_due` hands a member who failed every payment the rest of the unpaid
   * period, because `membershipAccess` counts `past_due` as open. This is the
   * same TERMINAL line `upsertSubscription` holds, on the one write that used
   * to bypass it.
   */
  const [advanced] = await db
    .update(subscriptions)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.id, row.id),
        notInArray(subscriptions.status, [...TERMINAL]),
      ),
    )
    .returning({ id: subscriptions.id });

  // Already dead: no status change, and no "pay this to keep your access"
  // mail to a member whose subscription is gone.
  if (!advanced) return `membership ${row.id} already terminal; late failure ignored`;

  /*
   * Told, and told what to do about it.
   *
   * Stripe's own dunning mail is off by default on a connected account and is
   * the seller's setting to make, not ours — so without this the first a
   * member hears of a failed payment is the day their access stops. The link
   * is Stripe's hosted invoice page, where they can pay it in one tap.
   */
  const client = row.clientId
    ? await db.query.clients.findFirst({ where: eq(clients.id, row.clientId) })
    : undefined;
  const to = client?.email ?? invoice.customer_email ?? null;

  if (to) {
    const product = row.productId
      ? await db.query.products.findFirst({ where: eq(products.id, row.productId) })
      : undefined;
    await sendMembershipPaymentFailed({
      shop,
      to,
      name: client?.name ?? null,
      productTitle: product?.title ?? "your membership",
      payUrl: invoice.hosted_invoice_url ?? null,
      until: row.currentPeriodEnd,
    });
  }

  await publishShopEvent(shop.id, "payment");

  /*
   * Emitted below the `advanced` guard, so a redelivered or late failure that
   * changed nothing tells nobody's integration that a payment just failed.
   *
   * Deliberately not an ending. `past_due` is a card that will very likely
   * clear on Stripe's next retry, and a consumer that revokes access here takes
   * it from a member whose card expired and was replaced the same afternoon —
   * `subscription.ended` is the event for revoking.
   */
  await emitSubscriptionWebhook({
    shop,
    event: "subscription.payment_failed",
    subscriptionId: row.id,
  });
  await notifySellerMembershipPaymentFailed({ shop, subscriptionId: row.id });

  return `membership ${row.id} past due`;
}
