/**
 * A subscription starting, changing, or ending.
 *
 * The three events that are about the arrangement rather than about a payment.
 */

import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, subscriptions } from "@sailo/db/schema";
import { actingAs } from "@sailo/commerce/orders/server";
import { publishShopEvent } from "@sailo/events";
import { emitSubscriptionWebhook } from "@sailo/webhooks/emit";
import { subscriptionTransitions } from "@sailo/webhooks/transitions";
import {
  notifySellerMembershipCancelled,
  notifySellerMembershipStarted,
} from "@sailo/workflows/memberships/notify-seller";
import { stripe } from "@sailo/payments";
import type Stripe from "stripe";
import { idOf } from "./read";
import {
  linkSignupOrder,
  shopForSender,
  shopForSubscription,
  upsertSubscription,
} from "./upsert";

/* --------------------------------------------------------------------------
   The events
-------------------------------------------------------------------------- */

/**
 * The member subscribed.
 *
 * The session tells us who they are — our order, our client, our product —
 * which no later event carries in full, so this is where those links are made.
 * The money is not confirmed here: `invoice.paid` does that, and on a trial it
 * does not happen for days.
 */
export async function handleSubscriptionCheckout(
  session: Stripe.Checkout.Session,
  accountId: string | null,
): Promise<string> {
  const db = getDb();

  const shop = await shopForSender(session.metadata?.shopId, accountId);
  if (!shop) return "membership checkout: not this account's shop";

  const subId = idOf(session.subscription);
  if (!subId) return "membership checkout: no subscription on session";

  /*
   * Read back from Stripe rather than trusted from the session.
   *
   * The session carries an id and little else — no status, no period end, no
   * price — and expanding it would still be Stripe's word at the moment the
   * session closed. Retrieving is one call on a path that happens once per
   * member, and it is the same shape every other handler here works from.
   */
  /*
   * `actingAs`, not a hand-written `stripeAccount` — it is the one place that
   * knows the platform's own account must *not* carry the header, and a
   * second copy of that rule here would be the copy that gets it wrong.
   */
  const sub = await stripe().subscriptions.retrieve(
    subId,
    {},
    actingAs(shop.stripeAccountId ?? ""),
  );

  const orderId = session.metadata?.orderId ?? session.client_reference_id ?? null;
  const order = orderId
    ? await db.query.orders.findFirst({
        where: and(eq(orders.id, orderId), eq(orders.shopId, shop.id)),
      })
    : undefined;

  const row = await upsertSubscription(sub, {
    shop,
    accountId,
    productId: session.metadata?.productId ?? order?.productId ?? null,
    clientId: session.metadata?.clientId ?? order?.clientId ?? null,
  });
  if (!row) return "membership checkout: subscription not written";

  /*
   * The order that started this becomes the first payment of the arrangement.
   *
   * Linked rather than replaced, so the seller sees one order for the signup
   * and one for each renewal — and so `invoice.paid` can recognise the first
   * invoice as already recorded instead of writing a duplicate for it.
   */
  if (order) await linkSignupOrder(order.id, shop.id, row.id);

  await publishShopEvent(shop.id, "order");
  /*
   * Awaited, not deferred with `after()`.
   *
   * This runs inside a Stripe webhook handler, not a Next request — there is no
   * response for `after()` to trail, and the process may be frozen the moment
   * this function returns. The rule the emit module states is "after the
   * business write", and the upsert above is that write.
   */
  await emitSubscriptionWebhook({
    shop,
    event: "subscription.created",
    subscriptionId: row.id,
  });
  await notifySellerMembershipStarted({ shop, subscriptionId: row.id });
  return `membership ${row.id} started (${sub.status})`;
}

/** Stripe's own view of the arrangement changed — status, period, cancellation. */
export async function handleSubscriptionChanged(
  sub: Stripe.Subscription,
  accountId: string | null,
): Promise<string> {
  const known = await shopForSubscription(sub.id, accountId);
  const shop =
    known?.shop ?? (await shopForSender(sub.metadata?.shopId, accountId));
  if (!shop) return "membership update: not this account's shop";

  const row = await upsertSubscription(sub, {
    shop,
    accountId,
    productId: sub.metadata?.productId ?? null,
    clientId: sub.metadata?.clientId ?? null,
  });
  if (!row) return "membership update: not written";

  /*
   * Linked here too, and not only from the checkout session.
   *
   * Stripe does not guarantee delivery order, and this event can arrive
   * before the session that caused it. When it does — and the first
   * `invoice.paid` then lands before the session as well — the signup order
   * was never pointed at its subscription, so the invoice could not recognise
   * it as the first payment: it wrote a *renewal* order instead and left the
   * signup sitting `unpaid` forever, showing the seller two orders for one
   * month and one of them never settling.
   *
   * Every path that learns about a subscription now does the same linking.
   * It is idempotent, so whichever arrives first wins and the rest are no-ops.
   */
  await linkSignupOrder(sub.metadata?.orderId, shop.id, row.id);

  await publishShopEvent(shop.id, "order");

  /*
   * What this update actually was.
   *
   * `known.row` is the state before `upsertSubscription` overwrote it — the
   * only copy of it that exists, which is why the lookup above is read for its
   * row and not only for its shop. Stripe names every one of these
   * `customer.subscription.updated`, so a plan change, a cancellation and a
   * resumption are indistinguishable without the comparison.
   *
   * Nothing is emitted when there was no previous row: that is a subscription
   * recovered out of order, and `subscription.created` covers it.
   */
  for (const event of subscriptionTransitions(known?.row ?? null, row)) {
    await emitSubscriptionWebhook({ shop, event, subscriptionId: row.id });

    /*
     * And mail the seller, for the one transition they can act on.
     *
     * Only `cancelled` — a plan change is the member choosing something the
     * seller already offers, and a resumption is good news that needs no
     * decision. `ended` is mailed from the delete handler below, where it
     * actually happens.
     */
    if (event === "subscription.cancelled") {
      await notifySellerMembershipCancelled({
        shop,
        subscriptionId: row.id,
        ended: false,
      });
    }
  }

  return `membership ${row.id} is ${sub.status}`;
}

/**
 * Stripe stopped the subscription for good.
 *
 * Written as `canceled` with the period end left exactly as it was, because
 * that end date is what still lets a member finish the month they paid for.
 * Clearing it here would take back access somebody has already bought.
 */
export async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
  accountId: string | null,
): Promise<string> {
  const known = await shopForSubscription(sub.id, accountId);
  const shop =
    known?.shop ?? (await shopForSender(sub.metadata?.shopId, accountId));
  if (!shop) return "membership delete: not this account's shop";

  const [row] = await getDb()
    .update(subscriptions)
    .set({
      status: "canceled",
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date(),
      cancelAtPeriodEnd: false,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
    .returning({ id: subscriptions.id });

  await publishShopEvent(shop.id, "order");

  /*
   * `ended`, not `cancelled`. The member asking to stop is the earlier event
   * and it fires from the update above; this one is the arrangement being over,
   * which is the day a consumer may actually revoke access.
   */
  if (row) {
    await emitSubscriptionWebhook({
      shop,
      event: "subscription.ended",
      subscriptionId: row.id,
    });
    await notifySellerMembershipCancelled({
      shop,
      subscriptionId: row.id,
      ended: true,
    });
  }

  return row ? `membership ${row.id} cancelled` : "membership delete: unknown subscription";
}

/**
 * A membership invoice was paid — the signup or any renewal after it.
 *
 * This is where the money is, and therefore where an order is written. Every
 * paid invoice becomes an ordinary order row so that Income, the CSV export
 * and the invoice sequence keep working without any of them learning what a
 * subscription is.
 *
 * The first invoice is the exception: `checkout.session.completed` already
 * linked the signup order, so writing another here would double-count the
 * month. It is recognised by the order that already points at this
 * subscription and carries no invoice id of its own yet.
 */
