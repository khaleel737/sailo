/**
 * Writing a subscription down, whatever we knew about it before.
 *
 * The convergence point: five different events all end up here, and each may know less than the
 * last. That is why it is an upsert rather than five writers — an event that arrives out of
 * order must not undo what a later one already recorded.
 */

import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, shops, subscriptions, type Shop, type Subscription } from "@sailo/db/schema";
import { actingAs } from "@sailo/commerce/orders/server";
import { feeBpFromPercent } from "@sailo/commerce/memberships";
import { sameAccount, sendingAccount, stripe } from "@sailo/payments";
import type Stripe from "stripe";
import { idOf, periodEndOf } from "./read";

/* --------------------------------------------------------------------------
   Ownership
-------------------------------------------------------------------------- */

/**
 * The shop an event may act on, or nothing.
 *
 * Every seller on Sailo controls their own Stripe account, so metadata naming
 * a shop is a *claim by the sender*, not evidence. A seller could otherwise
 * create a subscription on their own account with a rival's shop id in its
 * metadata and write rows into that rival's members list. The account the
 * event actually arrived on is the only thing that cannot be forged, so the
 * claim is checked against it.
 */
export async function shopForSender(
  shopId: string | null | undefined,
  accountId: string | null,
): Promise<Shop | null> {
  if (!shopId) return null;
  const shop = await getDb().query.shops.findFirst({ where: eq(shops.id, shopId) });
  if (!shop) return null;
  return sameAccount(shop.stripeAccountId, sendingAccount(accountId)) ? shop : null;
}

/**
 * The shop behind a subscription we have already recorded.
 *
 * The fallback for every event whose metadata is missing — a renewal invoice
 * eleven months after checkout, or a subscription a seller created by hand in
 * their dashboard. Scoped by the account stored on our own row, which was
 * written when the subscription was created and never changes.
 */
export async function shopForSubscription(
  stripeSubscriptionId: string,
  accountId: string | null,
): Promise<{ shop: Shop; row: Subscription } | null> {
  const row = await getDb().query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId),
  });
  if (!row) return null;
  if (!sameAccount(row.stripeAccountId, sendingAccount(accountId))) return null;

  const shop = await getDb().query.shops.findFirst({ where: eq(shops.id, row.shopId) });
  return shop ? { shop, row } : null;
}

/**
 * The subscription behind an event, recovering it from Stripe if we have to.
 *
 * The ordering hazard this exists for is not hypothetical: Stripe does not
 * guarantee delivery order, so `invoice.paid` for the very first period can
 * arrive before the `checkout.session.completed` that would have created our
 * row. With only the row lookup, that invoice was dropped — permanently,
 * because the event id is claimed and Stripe never retries a 2xx. The seller
 * would have a member Stripe was billing, no subscription in their list, and
 * no order for the money.
 *
 * So a miss is a reason to *ask*, not to give up: retrieve the subscription
 * from the account the event arrived on, verify its metadata names a shop on
 * that same account, and write the row that should already have existed. The
 * later `checkout.session.completed` then upserts over it harmlessly.
 */
export async function resolveSubscription(
  stripeSubscriptionId: string,
  accountId: string | null,
): Promise<{ shop: Shop; row: Subscription } | null> {
  const known = await shopForSubscription(stripeSubscriptionId, accountId);
  if (known) return known;

  const account = sendingAccount(accountId);
  if (!account) return null;

  let sub: Stripe.Subscription;
  try {
    sub = await stripe().subscriptions.retrieve(
      stripeSubscriptionId,
      {},
      actingAs(account),
    );
  } catch {
    // A subscription the sending account cannot show us is not ours to write.
    return null;
  }

  const shop = await shopForSender(sub.metadata?.shopId, accountId);
  if (!shop) return null;

  const row = await upsertSubscription(sub, {
    shop,
    accountId,
    productId: sub.metadata?.productId ?? null,
    clientId: sub.metadata?.clientId ?? null,
  });
  if (!row) return null;

  // The signup order was written before any of this and is still waiting to
  // be told which arrangement it belongs to.
  await linkSignupOrder(sub.metadata?.orderId, shop.id, row.id);

  return { shop, row };
}

/**
 * Points the order that started a membership at the subscription it created.
 *
 * Idempotent and shop-scoped. Two events race to do this — the checkout
 * session and, when it arrives first, the invoice — and both must be able to
 * run without the second undoing the first.
 */
export async function linkSignupOrder(
  orderId: string | null | undefined,
  shopId: string,
  subscriptionRowId: string,
): Promise<void> {
  if (!orderId) return;
  await getDb()
    .update(orders)
    .set({ subscriptionId: subscriptionRowId, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)));
}

/* --------------------------------------------------------------------------
   Writing it down
-------------------------------------------------------------------------- */

/**
 * Statuses past which a subscription does not come back.
 *
 * Stripe retries webhook deliveries for days, so a stale `updated` event can
 * land after a `deleted` one. Without this guard that retry would flip a
 * cancelled member back to active and let them into a gym they had left —
 * and nothing would report it, because both events are genuine and both are
 * from Stripe. A member who really does resubscribe gets a *new* subscription
 * with a new id, so this can never block a legitimate return.
 */
export const TERMINAL = new Set(["canceled", "unpaid"]);

export type UpsertContext = {
  shop: Shop;
  accountId: string | null;
  /** From metadata when present, so the first write knows what was bought. */
  productId?: string | null;
  clientId?: string | null;
};

/**
 * The subscription row, created or corrected.
 *
 * One statement, `onConflictDoUpdate` on the Stripe id, because the ordering
 * hazards above mean any of four events can be the first to arrive. Which one
 * got here first must not change the row that results.
 */
export async function upsertSubscription(
  sub: Stripe.Subscription,
  ctx: UpsertContext,
): Promise<Subscription | null> {
  const db = getDb();
  const item = sub.items?.data?.[0];
  const price = item?.price;

  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, sub.id),
  });
  if (existing && TERMINAL.has(existing.status) && !TERMINAL.has(sub.status)) {
    return existing;
  }

  const values = {
    shopId: ctx.shop.id,
    productId: ctx.productId ?? existing?.productId ?? null,
    clientId: ctx.clientId ?? existing?.clientId ?? null,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: idOf(sub.customer),
    stripeAccountId: sendingAccount(ctx.accountId),
    status: sub.status,
    currentPeriodEnd: periodEndOf(sub),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    /*
     * Snapshotted from the Price the member is actually on, not from the
     * product. A seller who re-prices tomorrow leaves existing members where
     * they are — Stripe Prices are immutable — so reading the product would
     * show a members list full of amounts nobody is being charged.
     */
    priceCents: price?.unit_amount ?? existing?.priceCents ?? 0,
    currency: (price?.currency ?? existing?.currency ?? ctx.shop.currency).toUpperCase(),
    interval: price?.recurring?.interval ?? existing?.interval ?? "month",
    /*
     * Stripe's word on what we are charging, never ours.
     *
     * Recorded here rather than written when `reconcileMembershipFees` asks
     * for the change, for the reason every other field in this object is read
     * off the event: a column we set optimistically would let a request that
     * Stripe rejected look reconciled for ever, and the sweep would never
     * come back to it. The sweep writes it too, so the row is honest within
     * the same tick -- but this is the write that decides.
     *
     * No `existing ?? ` fallback, unlike the price fields above. Those can be
     * absent from an event that legitimately knows less; this one is present
     * on every Subscription object, and `null` there is a real answer meaning
     * no fee rather than a gap to preserve.
     */
    applicationFeeBp: feeBpFromPercent(sub.application_fee_percent),
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: values,
    })
    .returning();

  return row ?? null;
}
