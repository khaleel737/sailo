import "server-only";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { affiliates, orders, reviews } from "@/db/schema";
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
        title: "Payment to confirm",
        body: `${order.customerName ?? "A buyer"} says they've paid ${formatMoney(order.totalCents, order.currency)} for ${order.productTitle}.`,
        href: "/admin/orders",
        at: order.updatedAt,
      });
    } else {
      items.push({
        id: `order:${order.id}`,
        kind: "order",
        title: "New order",
        body: `${order.productTitle}${order.quantity > 1 ? ` ×${order.quantity}` : ""} — ${formatMoney(order.totalCents, order.currency)}`,
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
      title: "Review awaiting approval",
      body: `${review.authorName} left ${review.rating} star${review.rating === 1 ? "" : "s"}.`,
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
      title: "Affiliate application",
      body: `${affiliate.name} wants to promote your shop.`,
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
      title: "Ready to ship",
      body: `${order.productTitle} for ${order.customerName ?? "a buyer"} — add tracking when you post it.`,
      href: "/admin/orders",
      at: order.updatedAt,
    });
  }

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 30);
}
