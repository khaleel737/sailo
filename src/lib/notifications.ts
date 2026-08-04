import "server-only";
import { orderSummaryTitle } from "@/lib/order-lines";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { affiliates, orders, reviews } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import { interpolate, plural } from "@/i18n";
import { formatMoney } from "@/lib/utils";

export type NotificationKind =
  | "order"
  | "payment"
  | "review"
  | "affiliate"
  | "shipment";

export type Notification = {
  /** Stable across reads so dismissals persist. */
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  at: Date;
};

/**
 * Notifications are derived from the data rather than stored as rows: an order
 * needing attention *is* the notification. That keeps them self-healing — deal
 * with the order and it stops appearing, with nothing to sync.
 *
 * `readAt` is the only stored piece, so dismissals survive a reload.
 */
export async function getNotifications(
  shopId: string,
  readAt: Date | null,
  t: Dictionary,
): Promise<Notification[]> {
  const db = getDb();
  const since = readAt ?? new Date(0);
  const items: Notification[] = [];

  const recentOrders = await db.query.orders.findMany({
    where: and(
      eq(orders.shopId, shopId),
      or(
        and(eq(orders.status, "new"), gt(orders.createdAt, since)),
        and(eq(orders.paymentStatus, "pending"), gt(orders.updatedAt, since)),
      ),
    ),
    orderBy: [desc(orders.createdAt)],
    limit: 20,
  });

  for (const order of recentOrders) {
    if (order.paymentStatus === "pending") {
      items.push({
        id: `payment:${order.id}`,
        kind: "payment",
        title: t.notifications.paymentToConfirm,
        body: interpolate(t.notifications.paymentBody, {
          name: order.customerName ?? t.notifications.aBuyer,
          amount: formatMoney(order.totalCents, order.currency),
          product: orderSummaryTitle(order),
        }),
        href: "/admin/orders",
        at: order.updatedAt,
      });
    } else {
      items.push({
        id: `order:${order.id}`,
        kind: "order",
        title: t.notifications.newOrder,
        // The variant matters to whoever has to pick the order off a shelf,
        // and a basket has to say it's a basket.
        body: `${orderSummaryTitle(order)}${
          order.itemCount > 1
            ? ` + ${order.itemCount - 1} more`
            : order.quantity > 1
              ? ` ×${order.quantity}`
              : ""
        } — ${formatMoney(order.totalCents, order.currency)}`,
        href: "/admin/orders",
        at: order.createdAt,
      });
    }
  }

  const pendingReviews = await db.query.reviews.findMany({
    where: and(
      eq(reviews.shopId, shopId),
      eq(reviews.isApproved, false),
      gt(reviews.createdAt, since),
    ),
    orderBy: [desc(reviews.createdAt)],
    limit: 10,
  });

  for (const review of pendingReviews) {
    items.push({
      id: `review:${review.id}`,
      kind: "review",
      title: t.notifications.reviewPending,
      body: interpolate(t.notifications.reviewBody, {
        name: review.authorName,
        rating: plural(review.rating, t.product.star, t.product.stars),
      }),
      href: "/admin/reviews",
      at: review.createdAt,
    });
  }

  const applications = await db.query.affiliates.findMany({
    where: and(
      eq(affiliates.shopId, shopId),
      eq(affiliates.status, "pending"),
      gt(affiliates.createdAt, since),
    ),
    orderBy: [desc(affiliates.createdAt)],
    limit: 10,
  });

  for (const affiliate of applications) {
    items.push({
      id: `affiliate:${affiliate.id}`,
      kind: "affiliate",
      title: t.notifications.affiliateApplication,
      body: interpolate(t.notifications.affiliateBody, { name: affiliate.name }),
      href: "/admin/affiliates",
      at: affiliate.createdAt,
    });
  }

  const toShip = await db.query.orders.findMany({
    where: and(
      eq(orders.shopId, shopId),
      eq(orders.deliveryMethod, "shipping"),
      eq(orders.status, "confirmed"),
      isNull(orders.shippedAt),
      gt(orders.updatedAt, since),
    ),
    orderBy: [desc(orders.updatedAt)],
    limit: 10,
  });

  for (const order of toShip) {
    items.push({
      id: `shipment:${order.id}`,
      kind: "shipment",
      title: t.notifications.readyToShip,
      body: interpolate(t.notifications.shipBody, {
        product: orderSummaryTitle(order),
        name: order.customerName ?? t.notifications.aBuyer,
      }),
      href: "/admin/orders",
      at: order.updatedAt,
    });
  }

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 30);
}
