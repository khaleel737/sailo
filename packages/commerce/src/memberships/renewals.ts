import "server-only";
import { and, eq, isNull, } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  orders,
  subscriptions,
  type Order,
  type Shop,
  type Subscription,
} from "@sailo/db/schema";
import { publishShopEvent } from "@sailo/events";
import { releaseDownloads } from "../orders/downloads";
import { createInvoiceForOrder } from "../orders/invoices";
import {
  intervalOf,
  isBillingInterval,
  nextPeriodEnd,
  normalizeIntervalCount,
  normalizeTrialDays,
} from "@sailo/commerce/memberships";

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
 *
 * A free trial is the one deliberate exception — spec 43. There the seller has
 * decided the first n days are free, so the door opens now and the record says
 * `trialing` with the period running to the end of it. See below.
 */
export async function createManualSubscription(opts: {
  shop: Shop;
  order: Pick<Order, "id" | "clientId" | "productId" | "paymentMethod" | "totalCents" | "currency">;
  interval: string;
  /** How many of them per charge. Absent is the ordinary every-one cycle. */
  intervalCount?: number;
  /**
   * A free trial, in days — spec 43. Null or absent is every signup that
   * existed before this: nothing until the seller confirms the money.
   */
  trialDays?: number | null;
}): Promise<Subscription | null> {
  const interval = isBillingInterval(opts.interval) ? opts.interval : "month";

  /*
   * A trial opens the door before any money has arrived, and that is the one
   * thing this function otherwise refuses to do.
   *
   * `incomplete` with no period end is the default precisely because somebody
   * who has *said* they will pay by bank transfer has not paid. A trial is the
   * seller deliberately choosing otherwise — they have decided the first n days
   * are free — so the honest record is `trialing` with the period running to
   * the end of it. `membershipAccess` already treats `trialing` as open and
   * already closes on `currentPeriodEnd`, so neither needed changing.
   *
   * Nothing here raises the first paid period. The manual-renewal cron finds
   * this subscription five days before the trial ends and raises it under the
   * same `renewalOrderedFor` claim every other renewal uses — one cycle engine,
   * not two.
   */
  const trialDays = normalizeTrialDays(opts.trialDays);
  const trialEndsAt = trialDays
    ? new Date(Date.now() + trialDays * 86_400_000)
    : null;

  const [row] = await getDb()
    .insert(subscriptions)
    .values({
      shopId: opts.shop.id,
      productId: opts.order.productId,
      clientId: opts.order.clientId,
      billingMode: "manual",
      paymentMethod: opts.order.paymentMethod,
      status: trialEndsAt ? "trialing" : "incomplete",
      currentPeriodEnd: trialEndsAt,
      priceCents: opts.order.totalCents,
      currency: opts.order.currency,
      interval,
      /*
       * Snapshotted alongside, because the renewal below reads this row and not
       * the product. Without it a member on a quarterly plan is asked to pay
       * again after a month — the interval says "month" and nothing else here
       * can say three of them.
       */
      intervalCount: normalizeIntervalCount(opts.intervalCount ?? 1, interval),
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

  /*
   * An order that bought nothing extends nothing — spec 43.
   *
   * A trial signup is a zero-value order carrying `subscriptionId`, written
   * `paid` because nothing is owed on it. Without this line a seller toggling
   * that order unpaid and back — an ordinary thing to do while tidying a list —
   * would land here and hand the member a free paid period on top of their free
   * trial. The trial's own period end is written by `createManualSubscription`;
   * the first *paid* period is raised by the cron and confirmed through an
   * order that has an amount on it.
   */
  if (order.totalCents <= 0) return null;

  const row = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, order.subscriptionId),
      eq(subscriptions.shopId, order.shopId),
    ),
  });
  if (!row || row.billingMode !== "manual") return null;

  const interval = intervalOf({ billingInterval: row.interval });
  const until = nextPeriodEnd(
    row.currentPeriodEnd,
    interval,
    new Date(),
    row.intervalCount,
  );

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
