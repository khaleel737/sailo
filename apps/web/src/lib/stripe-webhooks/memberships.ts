import "server-only";
import type Stripe from "stripe";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  orders,
  products,
  shops,
  subscriptions,
  type Shop,
  type Subscription,
} from "@sailo/db/schema";
import { createInvoiceForOrder } from "@/lib/invoices";
import { actingAs } from "@/lib/connect";
import { downloadUrl } from "@/lib/downloads";
import { publishShopEvent } from "@sailo/events";
import { releaseDownloads } from "@/lib/downloads";
import { sendMembershipPaymentFailed, sendMembershipStarted } from "@/lib/email/messages";
import { sameAccount, sendingAccount, stripe } from "@sailo/payments";

/**
 * A buyer paying a seller every month, as it arrives from Stripe.
 *
 * The rule the whole file is written around: **Stripe says what happened, this
 * writes down what it means for access.** Nothing here computes an amount, a
 * period or a proration — those are Stripe's and we copy them. What we own is
 * the answer to "does the door open", and that answer has to survive
 * at-least-once delivery, events arriving out of order, and a seller who
 * cancels a subscription from their own Stripe dashboard where our UI never
 * sees it.
 *
 * Three ordering hazards, all handled by never trusting arrival order:
 *
 *   - `customer.subscription.created` can arrive *before* the
 *     `checkout.session.completed` that caused it, so both upsert rather than
 *     one inserting and the other updating.
 *   - `invoice.paid` for the first period can arrive before either, so it
 *     upserts too and reads the subscription from Stripe when it has to.
 *   - `customer.subscription.updated` can arrive after `deleted` on a retry,
 *     which would resurrect a cancelled member — so a terminal status is
 *     never walked backwards.
 */

/* --------------------------------------------------------------------------
   Reading Stripe's shapes

   Both of these moved in recent API versions and the compiler cannot catch a
   field that is simply absent at runtime, so they are read in one place with
   the reason written down.
-------------------------------------------------------------------------- */

/**
 * When the period the member has paid for runs out.
 *
 * On the *item*, not the subscription. `Subscription.current_period_end` was
 * removed in the 2025-03 API version and this integration pins a later one —
 * reading the old field would compile (it is `any` through a cast) and return
 * undefined forever, which means every member's access would expire the
 * instant it was checked, or never expire at all depending on which way the
 * null was read. Both are silent.
 *
 * The furthest item wins: a subscription can hold several items on different
 * cycles, and access should last as long as the longest thing paid for.
 */
export function periodEndOf(sub: Stripe.Subscription): Date | null {
  const ends = sub.items?.data
    ?.map((item) => item.current_period_end)
    .filter((n): n is number => typeof n === "number");
  if (!ends || ends.length === 0) return null;
  return new Date(Math.max(...ends) * 1000);
}

/**
 * The subscription an invoice was raised for.
 *
 * `Invoice.subscription` is gone in this API version too; it lives under
 * `parent.subscription_details`. An invoice with no subscription parent is a
 * one-off invoice the seller raised in their own dashboard — not ours, and
 * not something to write an order for.
 */
export function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const link = invoice.parent?.subscription_details?.subscription;
  if (!link) return null;
  return typeof link === "string" ? link : link.id;
}

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  !value ? null : typeof value === "string" ? value : value.id;

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
async function shopForSender(
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
async function shopForSubscription(
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
async function resolveSubscription(
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
async function linkSignupOrder(
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
const TERMINAL = new Set(["canceled", "unpaid"]);

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
async function writeRenewalOrder(
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
  return `membership ${row.id} past due`;
}
