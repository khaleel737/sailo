"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, orders } from "@sailo/db/schema";
import { publishAffiliateEvent, publishShopEvent } from "@sailo/events";
import { requireShop } from "@/lib/session";
import { maybeRow } from "@sailo/core/invariant";
import { formatMoney, parseMoneyToCents } from "@/lib/utils";
import { restoreStock } from "@sailo/commerce/inventory";
import { changeOrderStatus } from "@sailo/commerce/orders";
import { refundOrder as refund } from "@sailo/commerce/refund-order";
import { isSellerSettablePaymentStatus } from "@/lib/payments";
import { isOrderStatus } from "@sailo/core/order-status";
import { releaseDownloads } from "@/lib/downloads";
import { extendForPaidOrder } from "@/lib/membership-renewals";
import { sendBookingDecision, sendRefundNotification, sendShippingNotification } from "@/lib/email";
import { emitOrderWebhook } from "@/lib/webhooks/emit";
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
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !isOrderStatus(status)) return;

  /*
   * The write, everything that follows from it, and everyone who is told.
   *
   * All of it used to be spelled out here, and it is now `changeOrderStatus` in
   * `@sailo/commerce` — not to tidy this function, but because the mobile app
   * changes statuses too and a second copy of any of it is a second chance to
   * forget the half that is silent. It was: the phone cancelled orders and
   * fired no `order.cancelled`, so a seller's Zap ran for a browser and not for
   * a thumb, and nothing anywhere said so.
   *
   * The two things handed in are the two that are genuinely this app's.
   * `revalidatePath` needs Next's request scope, which `apps/api` does not
   * have. `after` is the scheduler that keeps the seller's click off the
   * webhook queue; with none, the package awaits instead.
   */
  const change = await changeOrderStatus(
    { shop, orderId: id, status },
    {
      defer: after,
      revalidate: () => {
        revalidatePath("/admin");
        revalidatePath("/admin/orders");
        revalidatePath("/admin/clients");
        revalidatePath("/admin/products");
      },
    },
  );
  if (!change) return;
  const { previous, transition } = change;

  /*
   * An appointment the seller has now answered.
   *
   * Checkout tells the buyer the shop confirms their slot afterwards, and this
   * is where that happens: a booked order stays `new` through payment, so
   * moving it to `confirmed` is the seller accepting the time and moving it to
   * `cancelled` is them declining it. Either way the buyer is told, because a
   * promised confirmation that arrives as silence is worse than none.
   *
   * The last side effect still stranded in this app, and the only one the phone
   * does not perform. `sendBookingDecision` sits in a 3,000-line module that
   * owns Resend and fifteen other messages; extracting it is `packages/email`'s
   * job, not something to do on the way past. `transition` is the same decision
   * the webhook above was guarded on, so when that package lands this branch
   * moves rather than being rewritten — and until then the two cannot disagree
   * about whether a booking was answered.
   */
  if (transition.answeredBooking) {
    const decision = await sendBookingDecision({
      shop,
      order: previous,
      accepted: transition.bookingAccepted,
    });
    if (!decision.sent) {
      console.warn(`[sailo] booking decision not sent: ${decision.reason}`);
    }
  }

  /*
   * The action's own response repaints the tab it came from; the publish is
   * for every other screen looking at this shop — the seller's phone, the
   * staff panel, and the affiliate whose commission rides this order's
   * status. Scheduled with `after` so the seller's click never waits on it.
   */
  after(() => publishShopEvent(shop.id, "order"));
  if (previous.affiliateId) {
    const affiliateId = previous.affiliateId;
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
  /*
   * Read first, for one reason only: `order.paid` must describe a transition.
   *
   * `UPDATE … RETURNING` hands back the *new* row, so nothing after the write
   * can tell "the seller just confirmed the money" from "the seller re-saved a
   * dropdown that already said paid". The webhook cares about the difference —
   * a Zap that raises an invoice would raise a second one — and everything
   * else here is idempotent and deliberately left running either way, so this
   * read adds a question rather than changing an answer.
   */
  const before = await getDb().query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.shopId, shop.id)),
    columns: { paymentStatus: true },
  });

  const updated = maybeRow(await getDb()
    .update(orders)
    .set({ paymentStatus, updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.shopId, shop.id)))
    .returning({ id: orders.id }));

  // Confirming the money is what unlocks a held-back download, and the buyer
  // is emailed the link rather than being left to check back.
  if (updated && paymentStatus === "paid") {
    await releaseDownloads(updated.id);

    /*
     * And, on a manual membership, it is the whole billing system.
     *
     * There is no card and no webhook on a bank transfer or a handful of cash;
     * this dropdown is the only event in the product that means "the money
     * arrived". So it is what starts a membership and what extends it by
     * another period — `extendForPaidOrder` does nothing for any other kind of
     * order, and is idempotent for this one.
     */
    await extendForPaidOrder(updated.id);
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  if (updated) after(() => publishShopEvent(shop.id, "payment"));

  if (updated && paymentStatus === "paid" && before?.paymentStatus !== "paid") {
    after(() => emitOrderWebhook({ shop, event: "order.paid", orderId: id }));
  }
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

  /*
   * Emitted on every save, not only the first.
   *
   * Unlike a cancellation, re-saving this form is how a seller *corrects* a
   * tracking number they mistyped — so the second event is not a duplicate,
   * it is the fix, and a consumer that only ever saw the first would be
   * holding the wrong number for ever. `shippedAt` is preserved above, so the
   * dispatch date does not move when they do it.
   */
  after(() => emitOrderWebhook({ shop, event: "order.shipped", orderId: id }));
  return { ok: true, message: note };
}

/**
 * The seller giving money back.
 *
 * Every rule about *how* moved to `@sailo/commerce/refund-order` when the phone
 * grew a refund button — the SQL claim before the processor call, the release
 * on refusal, deciding fullness from the claim rather than from the row read
 * before it. What is left here is this surface's own half: parsing an amount
 * out of a form in the seller's locale, deferring the effects onto Next's
 * `after`, and revalidating the four pages a refund changes.
 */
export async function refundOrder(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();

  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("amount") ?? "").trim();

  /*
   * The order is read once here for its currency, which the amount cannot be
   * parsed without. `refundOrder` reads it again inside its own scope — that
   * is not a duplicated query worth removing, because the row it acts on has
   * to be the one it claims against, not one fetched before this function was
   * even called.
   */
  const order = await getDb().query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.shopId, shop.id)),
    columns: { currency: true },
  });
  if (!order) return { ok: false, error: "Order not found." };

  const result = await refund(
    {
      shop,
      orderId: id,
      // Blank means refund whatever is left, not the whole order again.
      amountCents: raw ? parseMoneyToCents(raw, order.currency) : null,
      reason: String(formData.get("reason") ?? ""),
    },
    {
      defer: (task) => after(task),
      notify: async ({ shop: s, order: o }) => {
        const sent = await sendRefundNotification({ shop: s, order: o });
        if (!sent.sent) console.error("[sailo] refund email failed:", sent.reason);
      },
    },
  );

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return { ok: false, error: "Order not found." };
      case "not_positive":
        return { ok: false, error: "Enter a refund amount above zero." };
      case "exceeds_remaining":
        return {
          ok: false,
          error: `Only ${formatMoney(result.remaining, order.currency)} is left to refund on this order.`,
        };
      case "raced":
        return {
          ok: false,
          error: "Another refund on this order went through first. Reload and check what's left.",
        };
      default:
        return { ok: false, error: `The payment couldn't be reversed: ${result.message}` };
    }
  }

  const amount = formatMoney(result.amountCents, order.currency);
  const note =
    result.outcome.kind === "reversed"
      ? `Refunded ${amount}. The money is on its way back to the buyer.`
      : result.outcome.reason === "never_charged"
        ? `Recorded a ${amount} refund. Nothing was ever charged for this order, so there is nothing to send back.`
        : `Recorded a ${amount} refund — this rail settles between you and the buyer, so pay them back yourself.`;

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/products");
  after(() => publishShopEvent(shop.id, "payment"));
  if (result.affiliateId) {
    const affiliateId = result.affiliateId;
    after(() => publishAffiliateEvent(affiliateId, "payment"));
  }

  /*
   * One event per refund, including each partial one — the payload's
   * `refunded` total says how much has come back altogether, and `total` says
   * what the order was, so a consumer can tell a £10 refund on a £50 order
   * from the second £10 refund on the same order.
   */
  after(() => emitOrderWebhook({ shop, event: "order.refunded", orderId: id }));
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
