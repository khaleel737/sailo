import { and, eq, inArray, or, sql } from "drizzle-orm";
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
