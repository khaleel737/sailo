"use server";

import { revalidatePath } from "next/cache";
import { resolveLines } from "@/lib/orders/resolve-lines";
import { readBuyer } from "@/lib/orders/buyer";
import { commissionBpFor } from "@/lib/orders/commission";
import { resolveCoupon } from "@/lib/orders/resolve-coupon";
import { upsertClient } from "@/lib/orders/clients";
import { resolveDelivery } from "@/lib/orders/delivery";
import { referralFor } from "@/lib/orders/referral";
import type { OrderIntentInput, OrderIntentResult, OrderLineInput, OrderPreview } from "@/lib/orders/types";
import { firstRow, maybeRow, present } from "@/lib/invariant";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimit } from "@/lib/redis";
import { callerIp } from "@/lib/client-ip";
import { affiliates, coupons, orderItems, orders, paymentMethods, shops, type Affiliate, type Coupon, type PaymentConfig } from "@/db/schema";
import { formatAddress, formatMoney } from "@/lib/utils";
import { bankDetailLines, buildHandoff, isPaymentMethodType, PAYMENT_METHOD_DEFS, PAYMENT_METHOD_TYPES, isRailUsable, type Handoff } from "@/lib/payments";
import { checkPaymentReference, TRANSFERABLE_PAYMENT_STATUSES } from "@/lib/payments/status";
import { checkCoupon, COUPON_MESSAGES, normalizeCode } from "@/lib/pricing";
import { createInvoiceForOrder, newInvoiceToken } from "@/lib/invoices";
import { can } from "@/lib/plans";
import { cartNeedsDelivery, cartSubtotal, quote, type Quote, type QuoteLine } from "@/lib/quote";
import { unitsLeft, variantLabel } from "@/lib/variants";
import { releaseStock, reserveStock } from "@/lib/inventory";
import { handOffToStripe } from "@/lib/orders/card-handoff";
import { claimCouponRedemption } from "@/lib/orders/coupon-redemption";
import { downloadUrl } from "@/lib/downloads";
import { resolveDigitalDelivery } from "@/lib/orders/digital-delivery";
import { confirmBuyerByEmail } from "@/lib/orders/confirm-buyer";


/**
 * The rails on which a buyer can quote a payment reference.
 *
 * Derived from the rail taxonomy rather than written out, so it cannot drift
 * from it: a `manual` rail is one where the buyer sends the money themselves
 * and the seller confirms it later, which is exactly the situation a reference
 * describes. `electronic` rails confirm themselves and `contact` rails settle
 * off-platform entirely.
 */
const REFERENCEABLE_RAILS = PAYMENT_METHOD_TYPES.filter(
  (type) => PAYMENT_METHOD_DEFS[type].kind === "manual",
);

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

  /* ---- Lines ----------------------------------------------------------- */

  const resolved = await resolveLines(shop.id, input.items, {
    strict: true,
    now,
  });
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { lines } = resolved;
  // The first line stands in for the order wherever one product is expected.
  // Every path above rejects an empty basket, but the header columns are
  // derived from this line and a silent undefined would write a broken order.
  const head = present(lines[0], "at least one order line");

  if (!isPaymentMethodType(input.paymentMethod)) {
    return { ok: false, error: "Pick how you'd like to order." };
  }

  const method = await db.query.paymentMethods.findFirst({
    where: and(
      eq(paymentMethods.shopId, shop.id),
      eq(paymentMethods.type, input.paymentMethod),
      eq(paymentMethods.isEnabled, true),
    ),
  });
  if (!method || !isRailUsable(method.type, method.config, shop)) {
    return { ok: false, error: "That option isn't available right now." };
  }
  // Gated rails are refused server-side too: a downgraded shop must not keep
  // taking card orders because a stale page still shows the button.
  if (method.type === "card" && !can(shop, "cardRails")) {
    return { ok: false, error: "That option isn't available right now." };
  }

  const def = PAYMENT_METHOD_DEFS[input.paymentMethod];

  /* ---- Delivery ------------------------------------------------------- */

  // One fee for the order, and only when something in it has to travel: a
  // basket of downloads and appointments is never shipped.
  const delivery = await resolveDelivery(
    shop.id,
    cartNeedsDelivery(lines),
    input.deliveryMethodId,
  );
  if (delivery === "unavailable") {
    return { ok: false, error: "Pick how you'd like to receive it." };
  }

  /* ---- Coupon --------------------------------------------------------- */

  const subtotalCents = cartSubtotal(lines);
  const discount = await resolveCoupon({
    shopId: shop.id,
    code: input.couponCode,
    subtotalCents,
    now,
  });
  if (!discount.ok) return { ok: false, error: discount.error };
  const coupon = discount.coupon;

  /* ---- Affiliate ------------------------------------------------------ */

  // Commission only accrues while the shop is actually entitled to it.
  const affiliatesLive = shop.affiliatesEnabled && can(shop, "affiliates");

  let affiliate: Affiliate | null = null;
  if (affiliatesLive && input.affiliateCode?.trim()) {
    const found = await db.query.affiliates.findFirst({
      where: and(
        eq(affiliates.shopId, shop.id),
        eq(affiliates.code, normalizeCode(input.affiliateCode)),
        eq(affiliates.status, "active"),
      ),
    });
    affiliate = found ?? null;
  }

  const commissionBp = commissionBpFor(affiliate, shop);

  const priced: Quote = quote({
    lines,
    coupon,
    deliveryMethod: delivery,
    commissionBp,
    tax: shop,
    collectAddress: shop.collectAddress,
    deliveryType: delivery?.type ?? null,
    now,
  });
  const totals = priced.totals;
  const wantsAddress = priced.needsAddress;

  const read = readBuyer(input, { def, wantsAddress });
  if (!read.ok) return { ok: false, error: read.error };
  const { name, email, phone, note, address } = read.buyer;

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
          ? (resolved.lines[position]?.product.serviceMode ?? null)
          : null,
      serviceLocation:
        line.kind === "service"
          ? (resolved.lines[position]?.product.serviceLocation ?? null)
          : null,
      position,
    })),
  ),
  // Both statements are the window that opened when the stock was reserved.
  // If the transaction fails, the units go back on the shelf on the way out.
  ]).catch(releasingStock(taken));

  const order = firstRow(inserted, "order");

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

  const invoice = await createInvoiceForOrder(shop.id, order.id, invoiceToken);

  /*
   * Best effort, and never fails the checkout.
   *
   * On the card rail the buyer has not paid yet — only the Checkout Session
   * exists — so this says "we have your order", not "we have your money". A
   * buyer who then abandons Stripe keeps an email for an order the sweep will
   * cancel, which is a real remaining gap: closing it means moving the send
   * onto the payment webhook, not reordering this function again.
   */
  if (email) {
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
    affiliatesLive && email
      ? await referralFor(shop, name, email, base)
      : null;

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/invoices");

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

/**
 * The delivery rate the buyer picked, or the shop's first one. Returns
 * `undefined` when nothing in the basket travels, and "unavailable" when the
 * buyer asked for a rate this shop doesn't offer.
 */
export async function previewOrder(input: {
  shopId: string;
  items: OrderLineInput[];
  deliveryMethodId?: string;
  couponCode?: string;
}): Promise<OrderPreview | { error: string }> {
  // Read-only, but it prices a whole basket on every keystroke in the coupon
  // field, so the ceiling is high enough never to reach a real shopper.
  const gate = await rateLimit(`quote:${await callerIp()}`, 120, 60);
  if (!gate.allowed) return { error: "Too many attempts. Wait a moment." };

  const db = getDb();
  const now = new Date();

  const shop = await db.query.shops.findFirst({
    where: and(eq(shops.id, input.shopId), eq(shops.isPublished, true), isNull(shops.suspendedAt)),
    columns: {
      id: true,
      currency: true,
      collectAddress: true,
      taxEnabled: true,
      taxName: true,
      taxRateBp: true,
      taxInclusive: true,
      taxOnDelivery: true,
    },
  });
  if (!shop) return { error: "Shop not found." };

  const resolved = await resolveLines(shop.id, input.items, {
    strict: false,
    now,
  });
  if (!resolved.ok) return { error: resolved.error };

  const delivery = await resolveDelivery(
    shop.id,
    cartNeedsDelivery(resolved.lines),
    input.deliveryMethodId,
  );

  let coupon: Coupon | null = null;
  let couponError: string | undefined;
  let couponApplied: string | undefined;

  if (input.couponCode?.trim()) {
    const code = normalizeCode(input.couponCode);
    const found = await db.query.coupons.findFirst({
      where: and(eq(coupons.shopId, shop.id), eq(coupons.code, code)),
    });
    // Judged against the whole basket, so a minimum spend counts every line.
    const verdict = checkCoupon(found, cartSubtotal(resolved.lines), now);
    if (!found) {
      couponError = COUPON_MESSAGES.not_found;
    } else if (verdict.ok) {
      coupon = found;
      couponApplied = code;
    } else {
      couponError = COUPON_MESSAGES[verdict.reason];
    }
  }

  const deliveryRate = delivery === "unavailable" ? undefined : delivery;
  const priced = quote({
    lines: resolved.lines,
    coupon,
    deliveryMethod: deliveryRate,
    tax: shop,
    collectAddress: shop.collectAddress,
    deliveryType: deliveryRate?.type ?? null,
    now,
  });

  return {
    totals: priced.totals,
    currency: shop.currency,
    tax: shop.taxEnabled
      ? {
          name: shop.taxName,
          rateBp: shop.taxRateBp,
          inclusive: shop.taxInclusive,
        }
      : null,
    lines: priced.lines.map((line, index) => ({
      productId: line.productId,
      variantId: line.variantId,
      title: line.title,
      label: line.label,
      kind: line.kind,
      imageUrl: line.imageUrl,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      subtotalCents: line.subtotalCents,
      // `priced.lines` is built from `resolved.lines` in order, so the index
      // lines up — but a missing entry means stock, not a crash.
      unitsLeft: resolved.lines[index]
        ? unitsLeft(resolved.lines[index].product, resolved.lines[index].variant)
        : null,
    })),
    unavailable: resolved.dropped.map((d) => ({
      productId: d.productId,
      variantId: d.variantId ?? null,
    })),
    needsDelivery: priced.needsDelivery,
    needsAddress: priced.needsAddress,
    hasService: priced.hasService,
    couponError,
    couponApplied,
  };
}

/**
 * Finds or creates the buyer's own referral code so they can share the shop
 * after ordering. Buyer-sourced affiliates start active — the seller can
 * disable them from the admin.
 */
export async function submitPaymentReference(input: {
  orderId: string;
  reference: string;
}): Promise<{ ok: boolean; error?: string }> {
  // Writes to someone else's order, identified only by its id.
  const gate = await rateLimit(`payref:${await callerIp()}`, 10, 60);
  if (!gate.allowed) {
    return { ok: false, error: "Too many attempts. Wait a moment and try again." };
  }

  const db = getDb();
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, input.orderId),
    columns: { id: true, paymentStatus: true, paymentMethod: true },
  });
  if (!order) return { ok: false, error: "Order not found." };

  const check = checkPaymentReference(order, input.reference);
  if (!check.ok) return { ok: false, error: check.error };

  /*
   * The status is repeated in the WHERE clause, and the rail with it.
   *
   * The status, because a chargeback arriving between the read and the write
   * would otherwise be overwritten by this update — the very thing the check
   * exists to prevent, in the window where it matters most.
   *
   * The rail, because this action is public and finds its order by id alone.
   * An abandoned *card* checkout also sits at `unpaid`, and moving one to
   * `pending` hid it from `releaseAbandonedCheckouts`, whose predicate is
   * `unpaid` plus the card rail — so anyone holding an order id could park a
   * shop's stock off the shelf permanently, repeatably. A transfer reference
   * is meaningless on a card order anyway: nobody transfers money for one.
   */
  const updated = maybeRow(
    await db
      .update(orders)
      .set({ paymentReference: check.reference, paymentStatus: "pending", updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, input.orderId),
          inArray(orders.paymentStatus, [...TRANSFERABLE_PAYMENT_STATUSES]),
          inArray(orders.paymentMethod, [...REFERENCEABLE_RAILS]),
        ),
      )
      .returning({ id: orders.id }),
  );

  /*
   * No row means the guard above rejected it — the order moved under us, or it
   * was never a rail that takes a reference. Reporting `ok` there told the
   * buyer their reference was recorded when it had been discarded, and left
   * the seller with nothing to reconcile against.
   */
  if (!updated) {
    return { ok: false, error: "This order is no longer awaiting a transfer." };
  }

  revalidatePath("/admin/orders");
  return { ok: true };
}
