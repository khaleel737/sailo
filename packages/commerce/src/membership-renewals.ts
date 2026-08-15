import "server-only";
import { and, asc, eq, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  orders,
  products,
  shops,
  subscriptions,
  type Order,
  type Shop,
  type Subscription,
} from "@sailo/db/schema";
import { publishShopEvent } from "@sailo/events";
import { releaseDownloads } from "./downloads";
import { createInvoiceForOrder } from "./invoices";
import {
  MANUAL_LAPSE_DAYS,
  RENEWAL_LEAD_DAYS,
  intervalOf,
  isBillingInterval,
  nextPeriodEnd,
} from "@sailo/core/memberships";

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
