import "server-only";
import { and, asc, eq, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
  clients,
  orders,
  products,
  shops,
  subscriptions,
  type Order,
  type Shop,
  type Subscription,
} from "@/db/schema";
import { publishShopEvent } from "@/lib/events";
import { downloadUrl } from "@/lib/downloads";
import { sendMembershipRenewalDue } from "@/lib/email/messages";
import { notifySellerOfOrder } from "@/lib/orders/notify-seller";
import { releaseDownloads } from "@/lib/downloads";
import { createInvoiceForOrder } from "@/lib/invoices";
import {
  MANUAL_LAPSE_DAYS,
  RENEWAL_LEAD_DAYS,
  intervalOf,
  isBillingInterval,
  nextPeriodEnd,
} from "@/lib/memberships";

/**
 * The renewal cycle, for every rail that is not a card.
 *
 * On the card path Stripe does all of this: it holds a card, raises an invoice
 * each period, charges it, retries when it fails, and tells us how it went.
 * On a bank transfer, cash at the door or a WhatsApp arrangement there is no
 * card and nobody else is going to raise anything — so Sailo does, and the
 * seller confirming the money is what moves the membership forward.
 *
 * The shape is deliberately the same as the card path's, because everything
 * downstream reads the same two columns:
 *
 *   Stripe path:  invoice raised → card charged → webhook → period extended
 *   Manual path:  order raised   → buyer pays   → seller confirms → extended
 *
 * Which means access, grace, the members list and cancellation needed no
 * second implementation. `membershipAccess` has never known who wrote
 * `currentPeriodEnd`, and that is the whole reason this was cheap to add.
 */

/* --------------------------------------------------------------------------
   Starting one
-------------------------------------------------------------------------- */

/**
 * The subscription row a manual signup creates, before any money has arrived.
 *
 * `incomplete` and no period end, which together mean no access: a member who
 * has said they will pay by bank transfer has not paid, and letting them in
 * on the promise is how a gym ends up with members it is not being paid for.
 * `startManualPeriod` is what opens the door, and only the seller confirming
 * the payment calls it.
 */
export async function createManualSubscription(opts: {
  shop: Shop;
  order: Pick<Order, "id" | "clientId" | "productId" | "paymentMethod" | "totalCents" | "currency">;
  interval: string;
}): Promise<Subscription | null> {
  const [row] = await getDb()
    .insert(subscriptions)
    .values({
      shopId: opts.shop.id,
      productId: opts.order.productId,
      clientId: opts.order.clientId,
      billingMode: "manual",
      paymentMethod: opts.order.paymentMethod,
      status: "incomplete",
      priceCents: opts.order.totalCents,
      currency: opts.order.currency,
      interval: isBillingInterval(opts.interval) ? opts.interval : "month",
    })
    .returning();

  return row ?? null;
}

/* --------------------------------------------------------------------------
   Moving one forward
-------------------------------------------------------------------------- */

/**
 * The money arrived, so the membership runs for another period.
 *
 * Called from exactly one place — the seller marking an order paid — because
 * that is the only event on a manual rail that means anything financial
 * happened. There is no webhook, no settlement notification, nothing else that
 * could stand in for a human saying "yes, that transfer landed".
 *
 * Idempotent by claim, not by check. `stripeInvoiceId`-style de-duplication
 * has no equivalent here, so the *order* is the unit: an order that has
 * already extended a membership carries `subscriptionId`, and the conditional
 * UPDATE below refuses to count it twice. A seller who flips an order from
 * paid to unpaid and back does not buy the member a second month.
 */
export async function extendForPaidOrder(orderId: string): Promise<Subscription | null> {
  const db = getDb();

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order?.subscriptionId || order.paymentStatus !== "paid") return null;

  const row = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, order.subscriptionId),
      eq(subscriptions.shopId, order.shopId),
    ),
  });
  if (!row || row.billingMode !== "manual") return null;

  const interval = intervalOf({ billingInterval: row.interval });
  const until = nextPeriodEnd(row.currentPeriodEnd, interval);

  /*
   * The claim, and it is the order that carries it.
   *
   * `membershipPeriodEnd` records which period this payment bought, and being
   * null is what "not counted yet" means. Claiming it in the WHERE is what
   * makes a seller toggling an order paid → unpaid → paid extend the
   * membership once rather than three times — there is no webhook here to
   * de-duplicate against, so the marker has to be ours.
   *
   * Stamped *before* the membership moves, so a crash between the two leaves a
   * membership that was not extended rather than one extended twice. Every
   * claim in this codebase fails in that direction.
   */
  const [claimed] = await db
    .update(orders)
    .set({ membershipPeriodEnd: until, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), isNull(orders.membershipPeriodEnd)))
    .returning({ id: orders.id });
  if (!claimed) return row;

  /*
   * Compare-and-set on the period we read, not just the id.
   *
   * The per-order claim above already stops one order extending twice. This
   * guards the other direction: a *different* paid order for the same manual
   * subscription, confirmed in the same instant, read the same
   * `currentPeriodEnd` and would write the same `until` on top — advancing one
   * period for two payments. Tying the write to the period it was computed from
   * means the second one finds the row already moved and lands nothing, rather
   * than silently overwriting. The cron keeps only one renewal open at a time,
   * so this is defence in depth, in the WHERE where this codebase keeps it.
   */
  const periodGuard = row.currentPeriodEnd
    ? eq(subscriptions.currentPeriodEnd, row.currentPeriodEnd)
    : isNull(subscriptions.currentPeriodEnd);
  const [extended] = await db
    .update(subscriptions)
    .set({
      status: "active",
      currentPeriodEnd: until,
      // The next renewal is a fresh question; whatever was raised for the last
      // period has now been paid for.
      renewalOrderedFor: null,
      startedAt: row.startedAt,
      updatedAt: new Date(),
    })
    .where(and(eq(subscriptions.id, row.id), periodGuard))
    .returning();

  /*
   * Files, if the membership carries any. The same call the card path makes,
   * and idempotent for the same reason: it claims `downloadReleasedAt` in its
   * own WHERE.
   */
  await releaseDownloads(orderId);
  await createInvoiceForOrder(order.shopId, orderId);
  await publishShopEvent(order.shopId, "order");

  return extended ?? row;
}

/* --------------------------------------------------------------------------
   Asking for the next one
-------------------------------------------------------------------------- */

export type RenewalTick = {
  raised: number;
  lapsed: number;
};

/**
 * One pass of the manual renewal cycle.
 *
 * Two jobs, in this order: raise the next period's order for memberships
 * coming up for renewal, and close the ones nobody has paid for in a long
 * time. Both are fleet-wide — this is a cron, not a per-shop action — and both
 * are claimed rather than checked, so two overlapping ticks do the work once
 * between them.
 */
export async function runManualRenewals(now = new Date()): Promise<RenewalTick> {
  const db = getDb();

  /*
   * Due, or nearly. `RENEWAL_LEAD_DAYS` ahead of the period end, because a
   * bank transfer takes days to arrive and the seller then has to see it: a
   * request sent on the morning access expires is a request that arrives too
   * late to be acted on.
   *
   * `cancelAtPeriodEnd` is excluded — a member who has said they are leaving
   * must not be sent an invitation to pay for another month.
   */
  const horizon = new Date(now.getTime() + RENEWAL_LEAD_DAYS * 86_400_000);

  const due = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.billingMode, "manual"),
      or(eq(subscriptions.status, "active"), eq(subscriptions.status, "past_due")),
      eq(subscriptions.cancelAtPeriodEnd, false),
      lte(subscriptions.currentPeriodEnd, horizon),
      /*
       * Not already asked. Compared against the period end rather than a
       * boolean, so the marker from *last* period does not suppress this
       * one — which is how a renewal system silently stops renewing.
       */
      or(
        isNull(subscriptions.renewalOrderedFor),
        ne(subscriptions.renewalOrderedFor, subscriptions.currentPeriodEnd),
      ),
    ),
    limit: 200,
  });

  let raised = 0;
  for (const row of due) {
    if (await raiseRenewalOrder(row)) raised += 1;
  }

  /*
   * And the ones nobody is paying. Access stopped when the period ended —
   * `membershipAccess` saw to that without any help — so this is only about
   * telling the truth in the seller's list and not asking for ever.
   */
  const lapseBefore = new Date(now.getTime() - MANUAL_LAPSE_DAYS * 86_400_000);
  const lapsed = await db
    .update(subscriptions)
    .set({ status: "canceled", canceledAt: now, updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.billingMode, "manual"),
        or(eq(subscriptions.status, "active"), eq(subscriptions.status, "past_due")),
        lte(subscriptions.currentPeriodEnd, lapseBefore),
      ),
    )
    .returning({ id: subscriptions.id });

  return { raised, lapsed: lapsed.length };
}

/**
 * The next period's order, raised once.
 *
 * The claim is the conditional UPDATE on `renewalOrderedFor`: only the caller
 * that moves it to this period's end goes on to write an order, so two ticks
 * running at once — or a tick that ran twice — ask the member for one month,
 * not two. Everything after the claim is safe to repeat.
 */
async function raiseRenewalOrder(row: Subscription): Promise<boolean> {
  const db = getDb();

  const [claimed] = await db
    .update(subscriptions)
    .set({
      renewalOrderedFor: row.currentPeriodEnd,
      // Asked and not yet paid. Access is untouched — they are still inside
      // the period they paid for, and `membershipAccess` closes it on time.
      status: "past_due",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(subscriptions.id, row.id),
        or(
          isNull(subscriptions.renewalOrderedFor),
          ne(subscriptions.renewalOrderedFor, subscriptions.currentPeriodEnd),
        ),
      ),
    )
    .returning();
  if (!claimed) return false;

  const [shop, client, product] = await Promise.all([
    db.query.shops.findFirst({ where: eq(shops.id, row.shopId) }),
    row.clientId
      ? db.query.clients.findFirst({ where: eq(clients.id, row.clientId) })
      : Promise.resolve(undefined),
    row.productId
      ? db.query.products.findFirst({ where: eq(products.id, row.productId) })
      : Promise.resolve(undefined),
  ]);
  if (!shop) return false;

  /*
   * An ordinary unpaid order, exactly like one the buyer placed themselves.
   *
   * That is what makes the rest of the product work without knowing about
   * memberships: it appears in the seller's order list, it can be marked paid
   * from the same dropdown, it carries the same payment instructions, and it
   * counts in Income when it settles. The only thing marking it out is
   * `subscriptionId`.
   *
   * Priced from the subscription, not the product: the member is on the price
   * they signed up at, and a seller raising their rates does not get to
   * silently re-price somebody mid-arrangement.
   */
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      productId: row.productId,
      clientId: row.clientId,
      subscriptionId: row.id,

      productTitle: product?.title ?? "Membership",
      productKind: "membership",
      unitPriceCents: row.priceCents,
      quantity: 1,
      itemCount: 1,
      currency: row.currency,
      subtotalCents: row.priceCents,
      totalCents: row.priceCents,

      customerName: client?.name ?? "Member",
      customerEmail: client?.email ?? null,
      customerPhone: client?.phone ?? null,

      paymentMethod: row.paymentMethod ?? "bank_transfer",
      paymentStatus: "unpaid",
      status: "new",
    })
    .returning();
  if (!order) return false;

  /*
   * And the member is told, because on this rail nothing else will tell them.
   *
   * The link is their own membership page — the signup order's token, which is
   * the one durable address they have — where the shop's payment instructions
   * live. Best-effort: a mail outage must not stop the renewal being raised,
   * because the order is what the seller collects against either way.
   */
  const to = client?.email ?? null;
  if (to) {
    const signup = await db.query.orders.findFirst({
      where: and(
        eq(orders.subscriptionId, row.id),
        isNotNull(orders.downloadToken),
      ),
      orderBy: [asc(orders.createdAt)],
    });

    await sendMembershipRenewalDue({
      shop,
      to,
      name: client?.name ?? null,
      productTitle: product?.title ?? "your membership",
      priceCents: row.priceCents,
      currency: row.currency,
      until: row.currentPeriodEnd,
      manageUrl: signup?.downloadToken ? downloadUrl(signup.downloadToken) : null,
    });
  }

  /*
   * The seller's copy, through the same path every other order uses — so it
   * respects their notification preferences rather than inventing a second
   * channel that ignores them.
   */
  await notifySellerOfOrder({ shop, orderId: order.id });

  await publishShopEvent(shop.id, "order");
  return true;
}
