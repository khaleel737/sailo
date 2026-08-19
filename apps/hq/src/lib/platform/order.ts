import "server-only";
import { and, asc, desc, eq, gte, ne, sql, type SQL } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  affiliates,
  clients,
  coupons,
  disputes,
  downloadEvents,
  earlyFraudWarnings,
  invoices,
  orderItems,
  orders,
  shops,
  subscriptions,
  tickets,
  user,
} from "@sailo/db/schema";
import { requireStaff } from "@/lib/session";
import { isUuid } from "@sailo/core/uuid";
import { linesFor } from "@sailo/core/order-lines";
import { parseUserAgent } from "@sailo/analytics/traffic";
import { daysAgo, num } from "./pagination";

/**
 * One order, and everything the platform knows about it.
 *
 * The list answers "what happened, roughly". This answers the questions
 * somebody actually opens an order for, and every one of them needs a
 * different table:
 *
 *   **What was sold** — `order_items`, not the header columns. The header
 *   describes the first line only, so reading it for a four-line basket is how
 *   the two money bugs in `@sailo/core/order-lines` happened.
 *
 *   **Whether the money is real** — the tax snapshot, the Stripe ids, the
 *   refund, and any chargeback or early fraud warning pointing back here.
 *
 *   **Who bought it** — the order's own snapshot of the buyer, the `clients`
 *   row behind it, and what else that person has bought. On this shop, and —
 *   because only HQ can see across shops — on the platform.
 *
 *   **Whether it was delivered** — tracking, a booked slot, released files
 *   with their download log, admissions.
 *
 *   **Where it came from**, as far as anything recorded can say. See
 *   `attribution` below, which is deliberately narrow about what it claims.
 *
 * Read-only. Nothing here writes, and no capability beyond `read` is asked
 * for: this is the same data /hq's lists already show, assembled per order.
 */

/** How far back the cross-shop lookups reach. */
const FORENSIC_WINDOW_DAYS = 365;

/** Same-address orders shown before the count stands in for the rest. */
const SAME_IP_LIMIT = 8;

export type PlatformOrder = NonNullable<
  Awaited<ReturnType<typeof getPlatformOrder>>
>;

export async function getPlatformOrder(id: string) {
  await requireStaff();

  /*
   * Postgres raises on a malformed uuid rather than returning nothing, so a
   * hand-typed URL would be a 500 instead of the 404 it is.
   */
  if (!isUuid(id)) return null;

  const db = getDb();

  const order = await db.query.orders.findFirst({ where: eq(orders.id, id) });
  if (!order) return null;

  const since = daysAgo(FORENSIC_WINDOW_DAYS);
  const emailKey = order.customerEmail?.trim().toLowerCase() || null;

  /*
   * How to find this person's other orders on this shop.
   *
   * `clientId` when there is one — that is the shop's own record of them and
   * it survives a changed email. Falling back to the address is what covers a
   * guest checkout, and it is scoped to the shop because two shops sharing a
   * buyer is not the same claim as one shop seeing them twice.
   */
  const buyerMatch: SQL | undefined = order.clientId
    ? eq(orders.clientId, order.clientId)
    : emailKey
      ? and(
          eq(orders.shopId, order.shopId),
          sql`lower(${orders.customerEmail}) = ${emailKey}`,
        )
      : undefined;

  const [
    owner,
    items,
    invoice,
    client,
    orderDisputes,
    warnings,
    downloads,
    admissions,
    affiliate,
    coupon,
    subscription,
    shopHistory,
    platformHistory,
    sameIp,
  ] = await Promise.all([
    db
      .select({
        shop: shops,
        ownerId: user.id,
        ownerName: user.name,
        ownerEmail: user.email,
      })
      .from(shops)
      .innerJoin(user, eq(user.id, shops.userId))
      .where(eq(shops.id, order.shopId))
      .limit(1),

    db.query.orderItems.findMany({
      where: eq(orderItems.orderId, order.id),
      orderBy: [asc(orderItems.position), asc(orderItems.createdAt)],
    }),

    db.query.invoices.findFirst({ where: eq(invoices.orderId, order.id) }),

    order.clientId
      ? db.query.clients.findFirst({ where: eq(clients.id, order.clientId) })
      : undefined,

    db.query.disputes.findMany({
      where: eq(disputes.orderId, order.id),
      orderBy: [desc(disputes.stripeCreatedAt)],
    }),

    db.query.earlyFraudWarnings.findMany({
      where: eq(earlyFraudWarnings.orderId, order.id),
      orderBy: [desc(earlyFraudWarnings.stripeCreatedAt)],
    }),

    /*
     * Oldest first, which is the order an issuer reads an access log in — and
     * the order `download_events_order_at_idx` already returns them in.
     */
    db.query.downloadEvents.findMany({
      where: eq(downloadEvents.orderId, order.id),
      orderBy: [asc(downloadEvents.at)],
    }),

    db.query.tickets.findMany({
      where: eq(tickets.orderId, order.id),
      orderBy: [asc(tickets.createdAt)],
    }),

    order.affiliateId
      ? db.query.affiliates.findFirst({
          where: eq(affiliates.id, order.affiliateId),
        })
      : undefined,

    order.couponId
      ? db.query.coupons.findFirst({ where: eq(coupons.id, order.couponId) })
      : undefined,

    order.subscriptionId
      ? db.query.subscriptions.findFirst({
          where: eq(subscriptions.id, order.subscriptionId),
        })
      : undefined,

    /* What this buyer has done with this shop, this order included. */
    buyerMatch
      ? db
          .select({
            orders: sql<string>`count(*)`,
            spentCents: sql<string>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
            firstAt: sql<string | null>`min(${orders.createdAt})`,
            lastAt: sql<string | null>`max(${orders.createdAt})`,
            disputed: sql<string>`count(*) filter (where ${orders.paymentStatus} = 'disputed')`,
            refunded: sql<string>`count(*) filter (where ${orders.refundedCents} > 0)`,
          })
          .from(orders)
          .where(buyerMatch)
      : undefined,

    /*
     * And what they have done everywhere else.
     *
     * The one question no seller can answer and the only reason to ask it
     * here: a buyer disputing their first order on this shop reads very
     * differently once you can see they have disputed on four others.
     *
     * A sequential scan — nothing indexes `customer_email`, deliberately, since
     * no seller-facing screen searches on it. Acceptable because /hq is staff
     * only and this is one query on one page. If orders ever grow past the
     * point where that is true, the fix is an index on
     * `lower(customer_email)`, not dropping the question.
     */
    emailKey
      ? db
          .select({
            orders: sql<string>`count(*)`,
            shops: sql<string>`count(distinct ${orders.shopId})`,
            disputed: sql<string>`count(*) filter (where ${orders.paymentStatus} = 'disputed')`,
            refunded: sql<string>`count(*) filter (where ${orders.refundedCents} > 0)`,
          })
          .from(orders)
          .where(sql`lower(${orders.customerEmail}) = ${emailKey}`)
      : undefined,

    /*
     * Other orders placed from the same address, across every shop.
     *
     * Bounded by a year rather than unbounded, both because `orders_created_idx`
     * can carry the range and because an address a year old has almost
     * certainly been reassigned to somebody else — a match that old is not
     * evidence of anything.
     *
     * Never identity, and never a gate. `buyerIp` is a header the client can
     * set, and behind a proxy it is whatever that proxy wrote; several honest
     * buyers share one address on a campus or a mobile carrier. This is a lead
     * for a person to follow, which is exactly what a fraud ring looks like
     * when it is one.
     */
    order.buyerIp
      ? db
          .select({
            id: orders.id,
            createdAt: orders.createdAt,
            totalCents: orders.totalCents,
            currency: orders.currency,
            status: orders.status,
            paymentStatus: orders.paymentStatus,
            customerName: orders.customerName,
            customerEmail: orders.customerEmail,
            shopName: shops.name,
            shopHandle: shops.handle,
            ownerId: shops.userId,
          })
          .from(orders)
          .innerJoin(shops, eq(shops.id, orders.shopId))
          .where(
            and(
              eq(orders.buyerIp, order.buyerIp),
              ne(orders.id, order.id),
              gte(orders.createdAt, since),
            ),
          )
          .orderBy(desc(orders.createdAt))
          .limit(SAME_IP_LIMIT + 1)
      : undefined,
  ]);

  const shopRow = owner[0];
  const history = shopHistory?.[0];
  const platform = platformHistory?.[0];
  const ipRows = sameIp ?? [];

  return {
    order,
    /*
     * The authoritative list of what was sold. `linesFor` falls back to the
     * header only when the order genuinely has one line, and returns nothing
     * at all for a multi-line order with no rows — which is corruption, and
     * shows here as an empty table rather than as a plausible wrong line.
     */
    lines: linesFor(order, items),
    itemRowCount: items.length,
    shop: shopRow?.shop ?? null,
    owner: shopRow
      ? { id: shopRow.ownerId, name: shopRow.ownerName, email: shopRow.ownerEmail }
      : null,
    invoice: invoice ?? null,
    client: client ?? null,
    disputes: orderDisputes,
    warnings,
    downloads,
    tickets: admissions,
    affiliate: affiliate ?? null,
    coupon: coupon ?? null,
    subscription: subscription ?? null,

    /** What the buyer's browser was, as far as the string will say. */
    device: parseUserAgent(order.buyerUserAgent),

    buyer: {
      onThisShop: history
        ? {
            orders: num(history.orders),
            spentCents: num(history.spentCents),
            firstAt: history.firstAt ? new Date(history.firstAt) : null,
            lastAt: history.lastAt ? new Date(history.lastAt) : null,
            disputed: num(history.disputed),
            refunded: num(history.refunded),
            /** How the other orders were matched, so the page can say. */
            matchedBy: order.clientId ? ("client" as const) : ("email" as const),
          }
        : null,
      acrossSailo: platform
        ? {
            orders: num(platform.orders),
            shops: num(platform.shops),
            disputed: num(platform.disputed),
            refunded: num(platform.refunded),
          }
        : null,
    },

    sameIp: {
      window: FORENSIC_WINDOW_DAYS,
      rows: ipRows.slice(0, SAME_IP_LIMIT),
      /** True when the cap hid some, so the page never implies it showed all. */
      more: ipRows.length > SAME_IP_LIMIT,
    },
  };
}
