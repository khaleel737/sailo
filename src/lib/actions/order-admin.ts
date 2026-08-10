"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clients, orders } from "@/db/schema";
import { publishAffiliateEvent, publishShopEvent } from "@/lib/events";
import { requireShop } from "@/lib/session";
import { maybeRow } from "@/lib/invariant";
import { formatMoney, parseMoneyToCents } from "@/lib/utils";
import { isStockReleasingStatus, restoreStock, retakeStock } from "@/lib/inventory";
import { checkRefund, refundableCents, reversePayment, type RefundOutcome } from "@/lib/refunds";
import { claimRefundAmount, releaseRefundClaim } from "@/lib/orders/refund-claim";
import { isSellerSettablePaymentStatus } from "@/lib/payments";
import { isOrderStatus } from "@/lib/order-status";
import { releaseDownloads } from "@/lib/downloads";
import { sendBookingDecision, sendRefundNotification, sendShippingNotification } from "@/lib/email";
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
   * An appointment the seller has now answered.
   *
   * Checkout tells the buyer the shop confirms their slot afterwards, and this
   * is where that happens: a booked order stays `new` through payment, so
   * moving it to `confirmed` is the seller accepting the time and moving it to
   * `cancelled` is them declining it. Either way the buyer is told, because a
   * promised confirmation that arrives as silence is worse than none.
   *
   * Guarded on the *previous* status, so re-saving an order that was already
   * confirmed does not email the buyer a second time.
   */
  if (order.scheduledFor && order.status === "new" && status !== "new") {
    const decision = await sendBookingDecision({
      shop,
      order,
      accepted: status !== "cancelled",
    });
    if (!decision.sent) {
      console.warn(`[sailo] booking decision not sent: ${decision.reason}`);
    }
  }

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

  /*
   * The action's own response repaints the tab it came from; the publish is
   * for every other screen looking at this shop — the seller's phone, the
   * staff panel, and the affiliate whose commission rides this order's
   * status. Scheduled with `after` so the seller's click never waits on it.
   */
  after(() => publishShopEvent(shop.id, "order"));
  if (order.affiliateId) {
    const affiliateId = order.affiliateId;
    after(() => publishAffiliateEvent(affiliateId, "order"));
  }
}

export async function updatePaymentStatus(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  const paymentStatus = String(formData.get("paymentStatus") ?? "");
  if (!id || !isSellerSettablePaymentStatus(paymentStatus)) return;

  /*
   * `maybeRow`, not `firstRow`. The WHERE carries the ownership check, so an
   * id belonging to another shop matches nothing — which is the guard working,
   * not an invariant breaking. `firstRow` threw on it and the seller got a 500
   * from a dropdown, while the `if (updated && …)` below sat there as
   * unreachable code proving `undefined` was what the author expected.
   */
  const updated = maybeRow(await getDb()
    .update(orders)
    .set({ paymentStatus, updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.shopId, shop.id)))
    .returning({ id: orders.id }));

  // Confirming the money is what unlocks a held-back download, and the buyer
  // is emailed the link rather than being left to check back.
  if (updated && paymentStatus === "paid") {
    await releaseDownloads(updated.id);
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  if (updated) after(() => publishShopEvent(shop.id, "payment"));
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
  after(() => publishShopEvent(shop.id, "order"));
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
  const requested = raw ? parseMoneyToCents(raw, order.currency) : refundableCents(order);
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

  /*
   * Take the amount out of the order's refundable balance before spending it.
   *
   * `checkRefund` above is a read against a row fetched before this function
   * calls Stripe, so two refunds issued in the same second both pass it. This
   * is the statement that actually enforces the ceiling — it accumulates in
   * SQL and compares column to column, so the loser is refused here rather
   * than after it has already moved money.
   */
  const claimed = await claimRefundAmount(order.id, shop.id, requested);
  if (!claimed) {
    return {
      ok: false,
      error: "Another refund on this order went through first. Reload and check what's left.",
    };
  }

  /*
   * Whether this order is now fully refunded, decided by the claim rather than
   * by the row read before it.
   *
   * `check.isFull` came from a snapshot taken before the claim, so two partial
   * refunds that between them consumed the whole balance each read themselves
   * as partial — and neither restocked nor moved the order to `refunded`. The
   * order sat fully refunded and still looking paid.
   */
  const isFull = claimed.refundedTotal >= order.totalCents;

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
    // The claim above reserved this amount; a processor that refused it must
    // not leave the balance spent, or the seller cannot retry.
    await releaseRefundClaim(order.id, requested);
    return {
      ok: false,
      error:
        error instanceof Error
          ? `The payment couldn't be reversed: ${error.message}`
          : "The payment couldn't be reversed. Nothing was changed.",
    };
  }

  // `refundedCents` is not set here — the claim above already added it.
  await db
    .update(orders)
    .set({
      refundedAt: new Date(),
      refundReason:
        String(formData.get("reason") ?? "").trim().slice(0, 300) || null,
      /*
       * Only ever written *to* `refunded`, never back from it.
       *
       * `order.status` is the row as it was before the claim, so a partial
       * refund running beside a concurrent one that completed the balance
       * would have written the stale value back over `refunded` — undoing the
       * other caller's conclusion and leaving a fully refunded order looking
       * active. A partial refund has nothing to say about the status, so it
       * says nothing.
       */
      ...(isFull ? { status: "refunded", paymentStatus: "refunded" } : {}),
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
  after(() => publishShopEvent(shop.id, "payment"));
  if (order.affiliateId) {
    const affiliateId = order.affiliateId;
    after(() => publishAffiliateEvent(affiliateId, "payment"));
  }
  return { ok: true, message: note };
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
  after(() => publishShopEvent(shop.id, "order"));
  if (order.affiliateId) {
    const affiliateId = order.affiliateId;
    after(() => publishAffiliateEvent(affiliateId, "order"));
  }
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
  after(() => publishShopEvent(shop.id, "client"));
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
  after(() => publishShopEvent(shop.id, "client"));
}
