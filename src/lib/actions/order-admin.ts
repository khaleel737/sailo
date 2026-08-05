"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clients, orders } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { firstRow, present } from "@/lib/invariant";
import { formatMoney, parseMoneyToCents } from "@/lib/utils";
import { restoreStock, retakeStock, isStockReleasingStatus } from "@/lib/inventory";
import { refundCharge } from "@/lib/connect";
import { releaseDownloads } from "@/lib/downloads";
import { sendRefundNotification, sendShippingNotification } from "@/lib/email";
import type { ActionState } from "./shop";

/** The statuses a seller may set. Anything else is a stale form or a bot. */
const ORDER_STATUSES = new Set([
  "new",
  "confirmed",
  "shipped",
  "completed",
  "cancelled",
  "refunded",
]);
const PAYMENT_STATUSES = new Set(["unpaid", "pending", "paid", "refunded"]);

/**
 * What a seller does to an order after it exists: confirm it, ship it, refund
 * it, cancel it, annotate the buyer.
 *
 * Split from `orders.ts` because it answers a different question. That file is
 * the buyer's path — resolve a basket, price it, take payment. This one is the
 * seller's, runs behind `requireShop`, and shares nothing with it but the
 * table.
 */

export async function updateOrderStatus(formData: FormData) {
  const { shop } = await requireShop();
  const db = getDb();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !ORDER_STATUSES.has(status)) return;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.shopId, shop.id)),
  });
  if (!order) return;

  await db
    .update(orders)
    .set({ status, updatedAt: new Date() })
    .where(eq(orders.id, id));

  // A cancelled order's units go back on the shelf; un-cancelling takes them
  // off again, so the count follows the seller rather than drifting.
  if (status === "cancelled") {
    await restoreStock(order);
  } else if (order.status === "cancelled" && order.restockedAt) {
    await retakeStock(order);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/products");
}

export async function updatePaymentStatus(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  const paymentStatus = String(formData.get("paymentStatus") ?? "");
  if (!id || !PAYMENT_STATUSES.has(paymentStatus)) return;

  const updated = firstRow(await getDb()
    .update(orders)
    .set({ paymentStatus, updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.shopId, shop.id)))
    .returning({ id: orders.id }), "updated");

  // Confirming the money is what unlocks a held-back download, and the buyer
  // is emailed the link rather than being left to check back.
  if (updated && paymentStatus === "paid") {
    await releaseDownloads(updated.id);
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
}

/**
 * Records dispatch details and moves the order to `shipped`. Emails the buyer
 * their tracking info when we have an address for them.
 */
export async function markOrderShipped(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();
  const db = getDb();

  const id = String(formData.get("id") ?? "");
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.shopId, shop.id)),
  });
  if (!order) return { ok: false, error: "Order not found." };

  const carrier = String(formData.get("trackingCarrier") ?? "").trim().slice(0, 80);
  const number = String(formData.get("trackingNumber") ?? "").trim().slice(0, 120);
  const urlRaw = String(formData.get("trackingUrl") ?? "").trim().slice(0, 500);

  let trackingUrl: string | null = null;
  if (urlRaw) {
    const candidate = /^https?:\/\//i.test(urlRaw) ? urlRaw : `https://${urlRaw}`;
    try {
      new URL(candidate);
      trackingUrl = candidate;
    } catch {
      return { ok: false, error: "That tracking link isn't a valid URL." };
    }
  }

  await db
    .update(orders)
    .set({
      trackingCarrier: carrier || null,
      trackingNumber: number || null,
      trackingUrl,
      shippedAt: order.shippedAt ?? new Date(),
      status: "shipped",
      updatedAt: new Date(),
    })
    .where(eq(orders.id, id));

  const updated = await db.query.orders.findFirst({ where: eq(orders.id, id) });
  let note = "Marked as shipped.";
  if (updated?.customerEmail) {
    const result = await sendShippingNotification({ shop, order: updated });
    note = result.sent
      ? `Marked as shipped and emailed ${updated.customerEmail}.`
      : `Marked as shipped, but the email failed: ${result.reason}`;
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  return { ok: true, message: note };
}

/**
 * Records a refund. The amount is capped at the order total and comes straight
 * off revenue; a full refund also moves the order to `refunded`.
 */
export async function refundOrder(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();
  const db = getDb();

  const id = String(formData.get("id") ?? "");
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.shopId, shop.id)),
  });
  if (!order) return { ok: false, error: "Order not found." };

  const raw = String(formData.get("amount") ?? "").trim();
  // Blank means refund everything.
  const requested = raw ? parseMoneyToCents(raw) : order.totalCents;
  if (requested <= 0) {
    return { ok: false, error: "Enter a refund amount above zero." };
  }
  if (requested > order.totalCents) {
    return {
      ok: false,
      error: `You can't refund more than the order total (${formatMoney(order.totalCents, order.currency)}).`,
    };
  }

  const isFull = requested === order.totalCents;
  await db
    .update(orders)
    .set({
      refundedCents: requested,
      refundedAt: new Date(),
      refundReason:
        String(formData.get("reason") ?? "").trim().slice(0, 300) || null,
      status: isFull ? "refunded" : order.status,
      paymentStatus: isFull ? "refunded" : order.paymentStatus,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, id));

  // A fully refunded order is one the buyer no longer has, so the units are
  // available again. A partial refund is a price adjustment, not a return.
  if (isFull) await restoreStock(order);

  const updated = await db.query.orders.findFirst({ where: eq(orders.id, id) });
  let note = `Refunded ${formatMoney(requested, order.currency)}.`;
  if (updated?.customerEmail) {
    const result = await sendRefundNotification({ shop, order: updated });
    if (!result.sent) note += ` Email failed: ${result.reason}`;
  }

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/products");
  return { ok: true, message: note };
}

/** Undoes a refund, e.g. one entered by mistake. */
export async function clearRefund(formData: FormData) {
  const { shop } = await requireShop();
  const db = getDb();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.shopId, shop.id)),
  });
  if (!order) return;

  await db
    .update(orders)
    .set({
      refundedCents: 0,
      refundedAt: null,
      refundReason: null,
      status: "confirmed",
      paymentStatus: "paid",
      updatedAt: new Date(),
    })
    .where(eq(orders.id, id));

  // The buyer has the goods again, so the units come back off the shelf.
  if (order.restockedAt) await retakeStock(order);
  // Marking it paid is also what releases a download that was waiting on it.
  await releaseDownloads(order.id);

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/products");
}

export async function deleteOrder(formData: FormData) {
  const { shop } = await requireShop();
  const db = getDb();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.shopId, shop.id)),
  });
  if (!order) return;

  // Deleting the record shouldn't leave its units counted against the seller.
  await restoreStock(order);
  await db.delete(orders).where(eq(orders.id, id));

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/products");
}

/** Removes clients that no longer have any orders. */
export async function deleteClient(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .delete(clients)
    .where(and(eq(clients.id, id), eq(clients.shopId, shop.id)));

  revalidatePath("/admin/clients");
  revalidatePath("/admin/orders");
}

export async function updateClientNotes(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000);
  if (!id) return;

  await getDb()
    .update(clients)
    .set({ notes: notes || null, updatedAt: new Date() })
    .where(and(eq(clients.id, id), eq(clients.shopId, shop.id)));

  revalidatePath(`/admin/clients/${id}`);
}
