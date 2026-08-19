import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { getReadDb } from "@sailo/db";
import {
  orders,
  products,
  reviews,
  visits,
} from "@sailo/db/schema";
import { inWindow, windowBounds } from "./bounds";
import type { Window } from "./bounds";

export async function getDashboardStats(shopId: string, window: Window = 30) {
  const db = getReadDb();
  const { since, until } = windowBounds(window);

  const [[visitRow], [periodRow], [openRow], [productRow], [reviewRow]] =
    await Promise.all([
      db
        .select({
          total: sql<string>`count(*)`,
          unique: sql<string>`count(distinct ${visits.sessionId})`,
        })
        .from(visits)
        .where(
          and(eq(visits.shopId, shopId), inWindow(visits.createdAt, since, until)),
        ),
      /*
       * What happened in the window the seller is looking at.
       *
       * This had no date bound at all, so a shop with two hundred lifetime
       * orders read "Last 30 days · Orders 200" in a month it had sold nothing
       * — four figures under one heading, two of them measuring a different
       * period from the other two. It also meant the app's home page
       * aggregated a shop's entire order history on every single load.
       */
      db
        .select({
          total: sql<string>`count(*)`,
          // Cancelled orders never counted; refunds come straight off the top.
          gross: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
          refunded: sql<string>`coalesce(sum(${orders.refundedCents}), 0)`,
          refundCount: sql<string>`count(*) filter (where ${orders.refundedCents} > 0)`,
          paid: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${orders.paymentStatus} = 'paid'), 0)`,
          // Tax the seller has collected and owes on. Cancelled orders never
          // happened; a refund hands the tax back with the rest of the money.
          tax: sql<string>`coalesce(sum(${orders.taxCents}) filter (where ${orders.status} <> 'cancelled' and ${orders.refundedCents} = 0), 0)`,
        })
        .from(orders)
        .where(
          and(eq(orders.shopId, shopId), inWindow(orders.createdAt, since, until)),
        ),
      /*
       * What still needs doing, whenever it happened.
       *
       * Deliberately not windowed. An order placed in March that has still not
       * shipped is exactly the one a seller must be told about, and bounding
       * this to thirty days would quietly hide it. Narrowed by state instead,
       * so it reads the open tail rather than every order ever placed.
       */
      db
        .select({
          pending: sql<string>`count(*) filter (where ${orders.status} = 'new')`,
          awaitingConfirm: sql<string>`count(*) filter (where ${orders.paymentStatus} = 'pending')`,
          awaitingShipment: sql<string>`count(*) filter (where ${orders.deliveryMethod} = 'shipping' and ${orders.status} in ('new','confirmed'))`,
          unpaidCommission: sql<string>`coalesce(sum(${orders.commissionCents}) filter (where not ${orders.commissionPaid}), 0)`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.shopId, shopId),
            or(
              inArray(orders.status, ["new", "confirmed"]),
              eq(orders.paymentStatus, "pending"),
              eq(orders.commissionPaid, false),
            ),
          ),
        ),
      db
        .select({
          total: sql<string>`count(*)`,
          published: sql<string>`count(*) filter (where ${products.isPublished})`,
        })
        .from(products)
        .where(eq(products.shopId, shopId)),
      db
        .select({
          pending: sql<string>`count(*) filter (where not ${reviews.isApproved})`,
        })
        .from(reviews)
        .where(eq(reviews.shopId, shopId)),
    ]);

  return {
    visitsInRange: Number(visitRow?.total ?? 0),
    uniqueVisitorsInRange: Number(visitRow?.unique ?? 0),
    totalOrders: Number(periodRow?.total ?? 0),
    newOrders: Number(openRow?.pending ?? 0),
    grossCents: Number(periodRow?.gross ?? 0),
    refundedCents: Number(periodRow?.refunded ?? 0),
    netRevenueCents:
      Number(periodRow?.gross ?? 0) - Number(periodRow?.refunded ?? 0),
    refundCount: Number(periodRow?.refundCount ?? 0),
    paidValueCents: Number(periodRow?.paid ?? 0),
    awaitingConfirmation: Number(openRow?.awaitingConfirm ?? 0),
    awaitingShipment: Number(openRow?.awaitingShipment ?? 0),
    unpaidCommissionCents: Number(openRow?.unpaidCommission ?? 0),
    taxCollectedCents: Number(periodRow?.tax ?? 0),
    totalProducts: Number(productRow?.total ?? 0),
    publishedProducts: Number(productRow?.published ?? 0),
    pendingReviews: Number(reviewRow?.pending ?? 0),
  };
}

/**
 * What a shop took, **grouped by the currency it was taken in** — spec 53.
 *
 * Every other money figure on the dashboard is a `sum(total_cents)` formatted
 * in `shops.currency`. That is exactly right for a shop quoting one currency,
 * which is every shop until a seller enables regional pricing — and it is a
 * wrong number the moment one of them does, because adding €25 to $29 and
 * calling the result dollars is arithmetic on two different units.
 *
 * v1 does not convert them and does not hide them. It returns the totals as
 * they are, one row per currency, and the dashboard names the ones that are
 * not the shop's own beside the headline figure rather than folding them into
 * it. Converting would need a rate policy — which rate, recorded where, as of
 * when — and that is a decision this feature deliberately does not make: see
 * `docs/specs/53-regional-pricing.md`.
 *
 * Returns an **empty array** when every order in the window is in the shop's
 * own currency, so the caller renders nothing at all in the ordinary case.
 */
export async function orderCurrencyMix(
  shopId: string,
  shopCurrency: string,
  window: Window = 30,
): Promise<{ currency: string; grossCents: number; orders: number }[]> {
  const db = getReadDb();
  const { since, until } = windowBounds(window);

  const rows = await db
    .select({
      currency: orders.currency,
      gross: sql<string>`coalesce(sum(${orders.totalCents}), 0)`,
      count: sql<string>`count(*)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, shopId),
        inWindow(orders.createdAt, since, until),
        // Cancelled orders never counted anywhere else on this page either.
        ne(orders.status, "cancelled"),
      ),
    )
    .groupBy(orders.currency);

  return rows
    .filter((r) => r.currency.toUpperCase() !== shopCurrency.toUpperCase())
    .map((r) => ({
      currency: r.currency.toUpperCase(),
      grossCents: Number(r.gross),
      orders: Number(r.count),
    }))
    /* Largest first: a seller reading a second line wants to know which
       currency actually matters, not which sorts first. */
    .sort((a, b) => b.grossCents - a.grossCents);
}
