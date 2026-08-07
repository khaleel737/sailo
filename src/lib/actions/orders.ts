"use server";

import { revalidatePath } from "next/cache";
import { resolveOrderIntent } from "@/lib/orders/resolve-intent";
import { upsertClient } from "@/lib/orders/clients";
import { referralFor } from "@/lib/orders/referral";
import type { OrderIntentInput, OrderIntentResult } from "@/lib/orders/types";
import { firstRow } from "@/lib/invariant";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimit } from "@/lib/redis";
import { callerIp } from "@/lib/client-ip";
import { orderItems, orders, shops, type PaymentConfig } from "@/db/schema";
import { formatAddress, formatMoney } from "@/lib/utils";
import { bankDetailLines, buildHandoff, type Handoff } from "@/lib/payments";
import { COUPON_MESSAGES } from "@/lib/pricing";
import { createInvoiceForOrder, newInvoiceToken } from "@/lib/invoices";
import { can } from "@/lib/plans";
import { type QuoteLine } from "@/lib/quote";
import { variantLabel } from "@/lib/variants";
import { releaseStock, reserveStock } from "@/lib/inventory";
import { handOffToStripe } from "@/lib/orders/card-handoff";
import { claimCouponRedemption } from "@/lib/orders/coupon-redemption";
import { claimSlots, releaseSlots } from "@/lib/booking/claim";
import { downloadUrl } from "@/lib/downloads";
import { resolveDigitalDelivery } from "@/lib/orders/digital-delivery";
import { confirmBuyerByEmail } from "@/lib/orders/confirm-buyer";


/**
 * Puts back every unit a cart had taken off the shelf.
 *
 * A cart is all-or-nothing, so any abandonment after the first reservation has
 * to undo all of them — the line that failed and the ones already held.
 */
async function releaseStockFor(lines: QuoteLine[]): Promise<void> {
  for (const line of lines) {
    await releaseStock({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
    });
  }
}

/**
 * A rejection handler that puts reserved stock back before rethrowing.
 *
 * Units come off the shelf before the order row is written, so everything
 * between those two points is a window where a throw strands them: no order
 * exists, so `releaseAbandonedCheckouts` has nothing to find, and nothing else
 * ever reclaims them. The shop reads as sold out for a sale that never
 * happened, and only a manual stock edit fixes it.
 *
 * Rethrows rather than swallowing — the caller still failed, and the buyer
 * still needs to hear so.
 */
function releasingStock(taken: QuoteLine[]) {
  return async (error: unknown): Promise<never> => {
    await releaseStockFor(taken);
    throw error;
  };
}

export async function createOrderIntent(
  input: OrderIntentInput,
): Promise<OrderIntentResult> {
  /*
   * Public and unauthenticated, and it reserves stock. Without a ceiling one
   * caller can hold a shop's entire inventory in unpaid orders faster than
   * the hourly sweep releases it, and the shop reads as sold out to everyone
   * else. Ten a minute is far above any real buyer.
   *
   * Fails open, like the rest: a limiter that blocks real orders when its own
   * backend is down costs more than the traffic it stops.
   */
  const gate = await rateLimit(`order:${await callerIp()}`, 10, 60);
  if (!gate.allowed) {
    return { ok: false, error: "Too many attempts. Wait a moment and try again." };
  }

  const db = getDb();

  const shop = await db.query.shops.findFirst({
    where: and(eq(shops.id, input.shopId), eq(shops.isPublished, true), isNull(shops.suspendedAt)),
  });
  if (!shop) return { ok: false, error: "Shop not found." };

  const now = new Date();

  /*
   * Everything this order is, worked out before anything is written down.
   *
   * The seam is not the line count — it is that nothing in there touches a
   * row. Which products at which prices, on which rail, with which delivery,
   * coupon and affiliate, for which buyer: each can fail, and failing costs
   * nothing, because no stock has been taken and no order written. Past this
   * point every failure needs an undo, and the undos are what the hardest bugs
   * in this file have been about.
   */
  const resolvedIntent = await resolveOrderIntent(shop, input, now);
  if (!resolvedIntent.ok) return { ok: false, error: resolvedIntent.error };
  const {
    lines,
    head,
    method,
    def,
    delivery,
    coupon,
    affiliate,
    priced,
    buyer: { name, email, phone, note, address },
  } = resolvedIntent.intent;
  const totals = priced.totals;

  const clientId = await upsertClient(shop.id, {
    name,
    email,
    phone,
    ...address,
  });

  /* ---- Stock ----------------------------------------------------------- */

  // Taken before the row is written: an order that can't be fulfilled is worse
  // than one that was never placed, and each guard is atomic so the last unit
  // can only be sold once. A cart is all-or-nothing — if the third line has
  // just sold out, the first two go back on the shelf.
  const taken: QuoteLine[] = [];
  for (const line of lines) {
    const ok = await reserveStock({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
      trackInventory: line.product.trackInventory,
    });
    if (ok) {
      taken.push(line);
      continue;
    }

    await releaseStockFor(taken);
    return {
      ok: false,
      error:
        line.quantity > 1
          ? `There isn't that much ${line.title} left. Try a smaller quantity.`
          : `${line.title} just sold out.`,
    };
  }

  /* ---- Digital delivery ------------------------------------------------ */

  // Reads the products' files, so it can fail — and the stock is already off
  // the shelf by here, which is why it hands the units back on the way out.
  const { deliversFiles, unlockNow, downloadToken, downloadExpiresAt, downloadLimit } =
    await resolveDigitalDelivery({
      lines,
      totalCents: totals.totalCents,
      now,
    }).catch(releasingStock(taken));

  /*
   * The order id is minted here rather than by the database.
   *
   * That is what lets the header and its lines go in one `db.batch()`, which
   * on neon-http is a single non-interactive transaction: both statements
   * commit or neither does. Previously the lines were a second round trip with
   * nothing to undo it, so a failure between them left a header row with no
   * lines — and `stockLinesFor` falls back to the header's own quantity when
   * it finds none, which attributes every unit in the basket to the first
   * product. The sweep then restocked a product that had never held them.
   *
   * This driver cannot open an interactive transaction at all
   * (`db.transaction()` throws), so a batch is the only atomicity available.
   */
  const orderId = crypto.randomUUID();

  const [inserted] = await db.batch([
    db
    .insert(orders)
    .values({
      id: orderId,
      shopId: shop.id,
      productId: head.productId,
      variantId: head.variantId,
      clientId,
      productTitle: head.title,
      variantLabel: head.variantOptions
        ? variantLabel(head.variantOptions, head.options)
        : null,
      variantSku: head.sku,
      productKind: head.kind,
      unitPriceCents: head.unitPriceCents,
      quantity: priced.unitCount,
      itemCount: lines.length,
      currency: shop.currency,

      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      deliveryFeeCents: totals.deliveryFeeCents,
      // Snapshot, not a reference: changing the shop's rate tomorrow must not
      // rewrite what this buyer was charged today.
      taxCents: totals.taxCents,
      taxRateBp: shop.taxEnabled ? shop.taxRateBp : 0,
      taxName: shop.taxEnabled ? shop.taxName : null,
      taxInclusive: shop.taxInclusive,
      totalCents: totals.totalCents,

      deliveryMethodId: delivery?.id ?? null,
      deliveryMethod: delivery?.type ?? null,
      deliveryLabel: delivery?.name ?? null,
      pickupLocation:
        delivery?.type === "collection"
          ? (delivery.config.address ?? null)
          : null,

      // Services: what was booked, and where it happens. Snapshotted so a
      // later edit to the product can't move an appointment already agreed.
      // Each line keeps its own; the header repeats the first booked one so a
      // list can show a time without a join.
      scheduledFor: lines.find((l) => l.scheduledFor)?.scheduledFor ?? null,
      serviceMode: head.kind === "service" ? head.product.serviceMode : null,
      serviceLocation:
        head.kind === "service" ? head.product.serviceLocation : null,

      // Digital: the token exists from the start; the release timestamp is
      // what actually opens the files.
      downloadToken,
      downloadReleasedAt: unlockNow ? now : null,
      downloadExpiresAt,
      downloadLimit,

      couponId: coupon?.id ?? null,
      couponCode: coupon?.code ?? null,

      affiliateId: affiliate?.id ?? null,
      affiliateCode: affiliate?.code ?? null,
      commissionCents: totals.commissionCents,

      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      ...address,
      note,
      paymentMethod: method.type,
      // COD is collected on delivery; transfers are owed until confirmed.
      paymentStatus: "unpaid",
    })
    .returning({ id: orders.id }),

  // The authoritative list of what was sold, in the same transaction as the
  // header so nothing can ever read the order in a one-line-only state.
  db.insert(orderItems).values(
    priced.lines.map((line, position) => ({
      orderId,
      productId: line.productId,
      variantId: line.variantId,
      title: line.title,
      variantLabel: line.label || null,
      sku: line.sku,
      kind: line.kind,
      imageUrl: line.imageUrl,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      subtotalCents: line.subtotalCents,
      scheduledFor: lines[position]?.scheduledFor ?? null,
      serviceMode:
        line.kind === "service"
          ? (lines[position]?.product.serviceMode ?? null)
          : null,
      serviceLocation:
        line.kind === "service"
          ? (lines[position]?.product.serviceLocation ?? null)
          : null,
      position,
    })),
  ),
  // Both statements are the window that opened when the stock was reserved.
  // If the transaction fails, the units go back on the shelf on the way out.
  ]).catch(releasingStock(taken));

  const order = firstRow(inserted, "order");

  /*
   * The appointments, claimed the way the stock was.
   *
   * `resolveLines` re-derived every slot against the shop's hours and its
   * existing bookings, but that is a read: two buyers asking for the same time
   * in the same second both passed it, and the shop owed one appointment to
   * two people with nothing anywhere to notice. The unique index behind
   * `claimSlots` is what actually decides, and it decides once.
   *
   * After the insert because the claim carries a foreign key to the order, and
   * before the coupon because losing a slot must not also burn a discount.
   */
  const slots = lines.flatMap((line) =>
    line.scheduledFor && line.productId
      ? [{ productId: line.productId, startsAt: line.scheduledFor }]
      : [],
  );
  if (!(await claimSlots(order.id, slots))) {
    await releaseStockFor(taken);
    await db.delete(orders).where(eq(orders.id, order.id));
    return {
      ok: false,
      error: "That time has just been taken. Pick another and try again.",
    };
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";

  /*
   * The invoice's public token, minted before the invoice exists.
   *
   * Stripe's success URL has to name the invoice, but claiming an invoice
   * number is one of the things that must not happen until the payment handoff
   * has succeeded — so the token is generated here, spent in the success URL
   * below, and only written to a row once Stripe has accepted the session.
   * Nothing resolves it until the buyer comes back from paying.
   */
  const invoiceToken = newInvoiceToken();

  /* ---- Card: hand the buyer to Stripe --------------------------------- */

  /*
   * Before the coupon, the invoice and the email, all of which this used to
   * run first.
   *
   * A failure here rolls the order and its stock reservation back, and those
   * are the only two things that *can* be rolled back. A redemption already
   * counted is a discount the buyer paid for and cannot use again; an invoice
   * number already claimed leaves a gap in a sequence a tax authority expects
   * to be unbroken; and an email already sent cannot be recalled — it told the
   * buyer their order was confirmed and linked them to an invoice that the
   * rollback then deleted. Stripe is the step most likely to fail of all of
   * them, so it goes first and everything irreversible waits behind it.
   */
  /*
   * The coupon is the exception to "nothing irreversible before the payment".
   *
   * A cap has to be enforced *before* the buyer pays — taking money on a
   * discount that was already exhausted is worse than either failure it sits
   * between. So it is claimed here, and given back explicitly if the handoff
   * then fails, which is the undo that did not exist when this ran first.
   */
  if (coupon && !(await claimCouponRedemption(coupon))) {
    await releaseStockFor(taken);
    // The delete cascades to `booking_claims`, but saying so here rather than
    // relying on it keeps the undo readable next to the thing it undoes.
    await releaseSlots(order.id);
    await db.delete(orders).where(eq(orders.id, order.id));
    return { ok: false, error: COUPON_MESSAGES.used_up };
  }

  let cardHandoff: Handoff | null = null;
  if (method.type === "card") {
    const card = await handOffToStripe({
      shop,
      orderId: order.id,
      // Stripe's receipt itemises the basket rather than lumping it under the
      // first product's name.
      items: priced.lines.map((line) => ({
        name: line.label ? `${line.title} — ${line.label}` : line.title,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
      })),
      successUrl: `${base}/invoice/${invoiceToken}?paid=1`,
      invoiceToken,
      cancelUrl:
        lines.length === 1
          ? `${base}/${shop.handle}/p/${head.product.slug}?cancelled=1`
          : `${base}/${shop.handle}?cancelled=1`,
    });

    // The handoff abandons the order on failure — stock and coupon both — so
    // there is nothing to undo here, only a message to pass on.
    if (!card.ok) return { ok: false, error: card.error };
    cardHandoff = card.handoff;
  }

  /* ---- Past here the order stands -------------------------------------- */

  /*
   * Whether the money is settled by the time this function returns.
   *
   * On every rail but card it is, in the only sense that matters: there is no
   * payment step to wait for. A bank transfer or a cash-on-delivery order is a
   * commitment the moment it is placed, the seller confirms the money later by
   * hand, and no webhook is ever coming — so the invoice and the confirmation
   * email have to be issued here or they never will be.
   *
   * A card order is the opposite. `handOffToStripe` has only created a
   * Checkout Session; the buyer has not paid and may never. Issuing an invoice
   * number now leaves a hole in the sequence when they abandon, and sending
   * "we have your order" hands them something un-recallable for an order the
   * sweep will cancel in 24 hours. Both move to
   * `checkout.session.completed`, which is where the money actually arrives.
   */
  const settlesAtCheckout = method.type !== "card";

  const invoice = settlesAtCheckout
    ? await createInvoiceForOrder(shop.id, order.id, invoiceToken)
    : null;

  /*
   * Best effort, and never fails the checkout.
   *
   * On the card rail the buyer has not paid yet — only the Checkout Session
   * exists — so this says "we have your order", not "we have your money". A
   * buyer who then abandons Stripe keeps an email for an order the sweep will
   * cancel, which is a real remaining gap: closing it means moving the send
   * onto the payment webhook, not reordering this function again.
   */
  if (email && settlesAtCheckout) {
    await confirmBuyerByEmail({
      shop,
      orderId: order.id,
      invoice,
      delivery: { deliversFiles, unlockNow, downloadToken },
      base,
    });
  }

  // Buyers who leave an email can be offered their own referral link.
  const referral =
    shop.affiliatesEnabled && can(shop, "affiliates") && email
      ? await referralFor(shop, name, email, base)
      : null;

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  // No `/admin/invoices` — there is no such route. Invoices are shown on the
  // order, and revalidating a path nothing serves is a line that reads like
  // cache invalidation while invalidating nothing.

  // A card buyer's handoff is Stripe's redirect, settled above. Every other
  // rail builds a message for the seller, and that message carries the invoice
  // number — which is why it is built here rather than before the payment.
  const handoff = cardHandoff ?? buildHandoff(method.type, method.config, {
    shopName: shop.name,
    // The seller reads this in a chat app, so every line goes in it — a cart
    // summarised to its first item would have them ringing back to ask.
    productTitle: priced.lines
      .map(
        (line) =>
          `${line.title}${line.label ? ` — ${line.label}` : ""}${
            line.quantity > 1 ? ` ×${line.quantity}` : ""
          }`,
      )
      .join("\n"),
    // Already spelled out per line above; repeating it would read as double.
    quantity: lines.length > 1 ? 1 : head.quantity,
    priceLabel: formatMoney(totals.totalCents, shop.currency),
    productUrl:
      base && lines.length === 1
        ? `${base}/${shop.handle}/p/${head.product.slug}`
        : base
          ? `${base}/${shop.handle}`
          : undefined,
    customerName: name ?? undefined,
    note: note ?? undefined,
    address: formatAddress(address) || undefined,
    delivery: delivery
      ? `${delivery.name}${
          delivery.type === "collection" && delivery.config.address
            ? ` — ${delivery.config.address}`
            : ""
        }`
      : undefined,
    discount:
      totals.discountCents > 0 && coupon
        ? `${coupon.code} (−${formatMoney(totals.discountCents, shop.currency)})`
        : undefined,
    invoiceNumber: invoice?.number,
  });

  const config = method.config as PaymentConfig;
  const deliveryInstructions = delivery
    ? [
        delivery.config.estimate,
        delivery.config.address,
        delivery.config.hours,
        delivery.config.instructions,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return {
    ok: true,
    orderId: order.id,
    handoff,
    methodName: def.name,
    totals,
    currency: shop.currency,
    invoiceUrl: invoice && base ? `${base}/invoice/${invoice.token}` : null,
    invoiceNumber: invoice?.number ?? null,
    downloadUrl:
      unlockNow && downloadToken ? downloadUrl(downloadToken, base) : null,
    downloadPending: deliversFiles && !unlockNow,
    referral,
    bankDetails:
      method.type === "bank_transfer" ? bankDetailLines(config) : undefined,
    instructions:
      [
        config.instructions?.trim(),
        deliveryInstructions.trim(),
        // Each service tells the buyer where to be, or how to join.
        ...new Set(
          lines.flatMap((l) =>
            l.kind === "service" && l.product.serviceLocation
              ? [l.product.serviceLocation.trim()]
              : [],
          ),
        ),
      ]
        .filter(Boolean)
        .join("\n\n") || undefined,
  };
}
