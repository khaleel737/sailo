"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, orders } from "@sailo/db/schema";
import { publishAffiliateEvent, publishShopEvent } from "@sailo/events";
import { requireShop } from "@/lib/session";
import { revalidateShop } from "@/lib/cache";
import { formatMoney, parseMoneyToCents } from "@sailo/core/currency";
import { restoreStock } from "@sailo/commerce/catalog";
import { changeOrderStatus } from "@sailo/commerce/orders/server";
import { refundOrder as refund } from "@sailo/commerce/orders/server";
import { shipOrder as ship } from "@sailo/commerce/orders/server";
import { recordShipment } from "@sailo/commerce/orders/server";
import { can } from "@sailo/core/plans";
import { setPaymentStatus as pay } from "@sailo/commerce/orders/server";
import { sendDownloadReady } from "@sailo/email/transactional";
import { isOrderStatus } from "@sailo/core/order-status";
import { sendBookingDecision, sendRefundNotification, sendShippingNotification } from "@/lib/email";
import { arrivalUrl, confirmDelivery, logOrderMessage } from "@sailo/commerce/disputes";
import { emitOrderWebhook } from "@sailo/webhooks/emit";
import { announceOrderEvent, announceOrderPaid } from "@sailo/workflows/orders";
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

/**
 * The seller confirming that money arrived.
 *
 * Everything this sets off — the held-back download opening, a manual
 * membership starting or extending — moved to `@sailo/commerce/pay-order` when
 * the phone grew the same control, because a surface that only flipped the
 * column would leave a buyer who had paid unable to get their file.
 *
 * What is left here is the webhook, and it is still guarded on the
 * *transition*: a Zap that raises an invoice would raise a second one on a
 * re-save. `becamePaid` is the shared function answering that question rather
 * than this one re-deriving it from a row it read for itself.
 */
export async function updatePaymentStatus(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  const paymentStatus = String(formData.get("paymentStatus") ?? "");
  if (!id) return;

  const result = await pay(
    { shop, orderId: id, paymentStatus },
    { notifyDownloads: (args) => sendDownloadReady(args) },
  );
  if (!result.ok) return;

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  after(() => publishShopEvent(shop.id, "payment"));

  if (result.becamePaid) {
    /*
     * One call, not two. The webhook and spec 30's `product.purchased`
     * enrolment are the same announcement made to two audiences, and the card
     * rail's settlement handler makes it too — a second copy here is the
     * "guard at one sink and not its twin" shape, on a path where the symptom
     * is a flow that silently never runs for bank-transfer buyers.
     */
    after(() =>
      announceOrderPaid({ shop, orderId: id }),
    );
  }
}

/**
 * Records dispatch details and moves the order to `shipped`. Emails the buyer
 * their tracking info when we have an address for them.
 *
 * The rules moved to `@sailo/commerce/ship-order` when the phone grew the same
 * button — notably the tracking-URL parse, which is the validation, because a
 * carrier's link is pasted by hand and the only place it is ever used is a
 * button in a buyer's inbox.
 */
export async function markOrderShipped(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");

  let note = "Marked as shipped.";

  const result = await ship(
    {
      shop,
      orderId: id,
      carrier: String(formData.get("trackingCarrier") ?? ""),
      trackingNumber: String(formData.get("trackingNumber") ?? ""),
      trackingUrl: String(formData.get("trackingUrl") ?? ""),
    },
    {
      /*
       * Awaited rather than deferred, unlike the refund's. The seller is told
       * whether the buyer was emailed, and `after()` runs once the response
       * has gone — so deferring would mean the message could never say.
       */
      notify: async ({ shop: s, order }) => {
        const sent = await sendShippingNotification({
          shop: s,
          order,
          /*
           * The arrival question, minted here because this is where the secret
           * is reachable. Spec 44: the cardholder's own confirmation is the
           * strongest `product_not_received` evidence there is, and this email
           * is the one moment the buyer is already thinking about the parcel.
           */
          arrivalUrl: arrivalUrl(order.id),
        });
        note = sent.sent
          ? `Marked as shipped and emailed ${order.customerEmail}.`
          : `Marked as shipped, but the email failed: ${sent.reason}`;

        /*
         * Kept against the order, like the confirmation. Only on a real send —
         * a logged message that never went is a false claim to a bank.
         */
        if (sent.sent) {
          await logOrderMessage({
            orderId: order.id,
            shopId: s.id,
            kind: "shipped",
            toAddress: order.customerEmail,
            subject: sent.subject,
            bodyText: sent.text,
            providerMessageId: sent.id,
            status: "sent",
          });
        }
        return sent;
      },
    },
  );

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "not_found"
          ? "Order not found."
          : "That tracking link isn't a valid URL.",
    };
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
/**
 * The seller ticking "it arrived".
 *
 * Spec 44. `shipped` is not `delivered` and `docs/chargebacks.md` says so in as
 * many words — *"a tracking number showing 'in transit' is not delivery"* — so
 * on `product_not_received` this is the difference between an evidence slot that
 * is filled and one that is empty.
 *
 * Recorded as `seller`, never as anything stronger. The three sources are not
 * equally persuasive and the evidence pack prints which one asserted it: a
 * seller's own tick presented as though a carrier had signed for it would be a
 * false claim to a bank, made on that seller's behalf, and it would lose the
 * case as well as damaging them.
 *
 * Deliberately not a status change. `ORDER_STATUSES` stays as it is — three
 * surfaces render status and the enum's own header records what happened last
 * time a copy of it drifted — and `completed` remains the seller's workflow
 * mark. This is a fact about the parcel.
 */
export async function markOrderDelivered(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Order not found." };

  /*
   * Scoped to the caller's own shop before anything is written. `confirmDelivery`
   * takes an order id and knows nothing about who is asking, so the ownership
   * check has to be here — an id from a form is a claim, not an authorisation.
   */
  const order = await getDb().query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.shopId, shop.id)),
    columns: { id: true },
  });
  if (!order) return { ok: false, error: "Order not found." };

  const result = await confirmDelivery({ orderId: id, source: "seller" });
  if (!result.ok) {
    return { ok: false, error: "Couldn't record that just now. Try again." };
  }

  revalidatePath("/admin/orders");
  await revalidateShop(shop.id);
  return {
    ok: true,
    message: result.alreadyConfirmed
      ? "Already recorded as delivered."
      : "Recorded as delivered.",
  };
}

/**
 * Records one box of an order that is going out in more than one — spec 51.
 *
 * Separate from `markOrderShipped` above rather than replacing it, and that is
 * a decision rather than an accident. The one-box case is most orders and its
 * form is three fields; making every seller pick lines before they can enter a
 * tracking number would tax the common case to serve the rare one. So the
 * simple button stays and this is what the "shipped in parts" panel posts to.
 *
 * Both write the same header columns, and `recordShipment` writes them with
 * `coalesce` so whichever ran first keeps them — a buyer emailed one tracking
 * number must not find their link resolving to a different parcel.
 */
export async function recordOrderShipment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop();

  /*
   * Gated here as well as in the panel, because a form is not a gate.
   * `requireShop` says who is asking; the plan says what they bought.
   */
  if (!can(shop, "weightBands")) {
    return { ok: false, error: "Shipping an order in parts is on Business." };
  }

  const id = String(formData.get("id") ?? "");

  /*
   * One field per line, named for the line, so an empty box posts nothing and
   * shifts nothing. Parallel arrays would silently move a quantity onto the
   * wrong line the moment a seller left one blank — the same defect the variant
   * editor's JSON-per-row shape exists to prevent.
   */
  const items = formData
    .getAll("shipItemId")
    .map((raw) => String(raw))
    .flatMap((orderItemId) => {
      const quantity = Number(formData.get(`shipQty:${orderItemId}`) ?? 0);
      return Number.isFinite(quantity) && quantity > 0
        ? [{ orderItemId, quantity: Math.trunc(quantity) }]
        : [];
    });

  const result = await recordShipment({
    shopId: shop.id,
    orderId: id,
    carrier: String(formData.get("trackingCarrier") ?? ""),
    trackingNumber: String(formData.get("trackingNumber") ?? ""),
    trackingUrl: String(formData.get("trackingUrl") ?? ""),
    note: String(formData.get("shipmentNote") ?? ""),
    items,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "not_found":
        return { ok: false, error: "Order not found." };
      case "nothing_to_ship":
        return { ok: false, error: "Choose at least one item for this box." };
      case "bad_tracking_url":
        return { ok: false, error: "That tracking link isn't a valid URL." };
      case "over_shipped":
        return {
          ok: false,
          error: `Only ${result.remaining} of ${result.title} is left to ship.`,
        };
    }
  }

  revalidatePath("/admin/orders");
  after(() => publishShopEvent(shop.id, "order"));
  /*
   * The same event the single-box button emits, on every box — a consumer
   * tracking dispatch wants to hear about the second parcel as much as the
   * first, and `order.shipped` is already documented as repeatable.
   */
  after(() => emitOrderWebhook({ shop, event: "order.shipped", orderId: id }));

  return {
    ok: true,
    message: result.complete
      ? "Recorded. Every item on this order has now shipped."
      : "Recorded. The rest of this order is still to go.",
  };
}

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
      /*
       * Whether it goes back on the shelf — spec 51.
       *
       * A checkbox that ships *ticked*, so the absence of the field means
       * "restock", which is what every refund did before this. Reading an
       * unchecked box as "do not restock" is the whole point: a seller who has
       * deliberately unticked it is telling us the item is damaged, and that is
       * an answer only they have.
       *
       * `=== "on"` rather than `!== "off"`, because an unchecked checkbox posts
       * nothing at all — the same reader every other toggle on this form uses.
       */
      restock: formData.get("restock") === "on",
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
  /*
   * `order.refunded` — a webhook and, since spec 31, a scenario trigger. Both
   * from one call for the reason `announceOrderPaid` gives: two audiences, one
   * announcement, and a second copy is one of them silently missing.
   */
  after(() => announceOrderEvent({ shop, event: "order.refunded", orderId: id }));
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
