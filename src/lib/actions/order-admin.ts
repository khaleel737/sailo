"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clients, orders } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { firstRow } from "@/lib/invariant";
import { formatMoney, parseMoneyToCents } from "@/lib/utils";
import { isStockReleasingStatus, restoreStock, retakeStock } from "@/lib/inventory";
import { canReverse, checkRefund, refundableCents, reversePayment, type RefundOutcome } from "@/lib/refunds";
import { isSellerSettablePaymentStatus } from "@/lib/payments";
import { isOrderStatus } from "@/lib/order-status";
import { releaseDownloads } from "@/lib/downloads";
import { sendRefundNotification, sendShippingNotification } from "@/lib/email";
import type { ActionState } from "./shop";

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
  if (!id || !isOrderStatus(status)) return;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.shopId, shop.id)),
  });
  if (!order) return;

  await db
    .update(orders)
    .set({ status, updatedAt: new Date() })
    .where(eq(orders.id, id));

  /*
   * A cancelled *or refunded* order's units go back on the shelf; moving it
   * back out of either takes them off again, so the count follows the seller
   * rather than drifting.
   *
   * This used to name "cancelled" twice and nothing else, while
   * `isStockReleasingStatus` — written, tested, and wired to nothing — said
   * refunded released stock too. A seller refunding from this dropdown got the
   * goods back in their hands and the shop still counting them as sold. The
   * refund *action* restocks on a full refund, so the two ways to refund an
   * order disagreed with each other as well.
   */
  if (isStockReleasingStatus(status)) {
    await restoreStock(order);
  } else if (order.status === "cancelled" && order.restockedAt) {
    /*
     * Only *cancelled* is reversible, and the asymmetry is deliberate.
     *
     * Un-cancelling is a seller correcting a mistake: the goods never left, so
     * taking them back off the shelf is right. Refunding is not a mistake — the
     * money went back and, ordinarily, so did the goods. Reading this branch as
     * `isStockReleasingStatus(order.status)` meant a seller who refunded an
     * order and then tidied it to `completed` silently had the returned units
     * taken off the shelf again, with the refund still standing.
     */
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
  if (!id || !isSellerSettablePaymentStatus(paymentStatus)) return;

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
      // Parsing is the validation — a carrier's tracking link is pasted by
      // hand and half of them arrive without a scheme or with a stray space.
      trackingUrl = new URL(candidate).toString();
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
  // Blank means refund whatever is left, not the whole order again.
  const requested = raw ? parseMoneyToCents(raw) : refundableCents(order);
  const check = checkRefund(order, requested);
  if (!check.ok) {
    return {
      ok: false,
      error:
        check.reason === "not_positive"
          ? "Enter a refund amount above zero."
          : `Only ${formatMoney(check.remaining, order.currency)} is left to refund on this order.`,
    };
  }
  const isFull = check.isFull;

  /*
   * Give the money back before writing down that we did.
   *
   * This used to record the refund in our own table and email the buyer to say
   * it had happened — without ever calling the processor. The order read
   * "refunded", the buyer read "your money is on its way", and nothing moved.
   * A payments product may fail to refund; it may never claim it refunded when
   * it didn't.
   *
   * Which reversal to call is the order's own business: it records the rail it
   * was paid on, and `reversePayment` asks that rail. See lib/refunds.ts.
   */
  let outcome: RefundOutcome;
  try {
    outcome = await reversePayment(order, requested);
  } catch (error) {
    console.error("[sailo] refund failed:", error);
    return {
      ok: false,
      error:
        error instanceof Error
          ? `The payment couldn't be reversed: ${error.message}`
          : "The payment couldn't be reversed. Nothing was changed.",
    };
  }

  await db
    .update(orders)
    .set({
      refundedCents: check.refundedTotal,
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
  const amount = formatMoney(requested, order.currency);
  let note =
    outcome.kind === "reversed"
      ? `Refunded ${amount}. The money is on its way back to the buyer.`
      : outcome.reason === "never_charged"
        ? `Recorded a ${amount} refund. Nothing was ever charged for this order, so there is nothing to send back.`
        : `Recorded a ${amount} refund — this rail settles between you and the buyer, so pay them back yourself.`;
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

/**
 * Undoes a refund that was only ever a note in our own table.
 *
 * A refund that actually moved money cannot be undone from here: the money has
 * left the seller's Stripe balance and only a fresh charge would bring it back,
 * which is not something to do behind a button labelled "clear". Clearing the
 * row would leave us claiming the buyer was never refunded while their bank
 * says otherwise, which is worse than the mistake being corrected.
 */
export async function clearRefund(formData: FormData) {
  const { shop } = await requireShop();
  const db = getDb();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.shopId, shop.id)),
  });
  if (!order) return;

  if (order.stripePaymentIntentId && canReverse(order)) {
    console.warn(
      `[sailo] refusing to clear a processed refund on order ${order.id} — ` +
        "the money already went back to the buyer",
    );
    return;
  }

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
