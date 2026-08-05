"use server";

import { revalidatePath } from "next/cache";
import { resolveLines } from "@/lib/orders/resolve-lines";
import { clean } from "@/lib/orders/sanitize";
import { upsertClient } from "@/lib/orders/clients";
import { resolveDelivery, smallest, soonest } from "@/lib/orders/delivery";
import { parseBooking } from "@/lib/orders/booking";
import { referralFor } from "@/lib/orders/referral";
import type {
  OrderAddress,
  OrderIntentInput,
  OrderIntentResult,
  OrderLineInput,
  OrderPreview,
} from "@/lib/orders/types";
import { firstRow, present } from "@/lib/invariant";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  affiliates,
  clients,
  coupons,
  deliveryMethods,
  orderItems,
  orders,
  paymentMethods,
  products,
  productVariants,
  shops,
  type Affiliate,
  type Coupon,
  type PaymentConfig,
  type Product,
  type ProductVariant,
  type Shop,
} from "@/db/schema";
import { requireShop } from "@/lib/session";
import {
  formatAddress,
  formatMoney,
  normalizePhone,
  parseMoneyToCents,
} from "@/lib/utils";
import {
  sendOrderConfirmation,
  sendRefundNotification,
  sendShippingNotification,
} from "@/lib/email";
import type { ActionState } from "./shop";
import {
  bankDetailLines,
  buildHandoff,
  isPaymentMethodType,
  PAYMENT_METHOD_DEFS,
  isRailUsable,
  type Handoff,
} from "@/lib/payments";
import { isDeliveryConfigured } from "@/lib/delivery";
import {
  checkCoupon,
  COUPON_MESSAGES,
  formatPercent,
  generateCode,
  normalizeCode,
  type Totals,
} from "@/lib/pricing";
import { createInvoiceForOrder } from "@/lib/invoices";
import { can } from "@/lib/plans";
import {
  cartNeedsDelivery,
  cartSubtotal,
  quote,
  type Quote,
  type QuoteLine,
} from "@/lib/quote";
import {
  clampQuantity,
  isSellable,
  maxOrderable,
  unitsLeft,
  variantLabel,
  variantPrice,
} from "@/lib/variants";
import {
  releaseStock,
  reserveStock,
  restoreStock,
  retakeStock,
} from "@/lib/inventory";
import { createCheckoutSession } from "@/lib/connect";
import {
  downloadExpiry,
  downloadUrl,
  hasDeliverableFiles,
  newDownloadToken,
  releaseDownloads,
  releasesImmediately,
} from "@/lib/downloads";


export async function createOrderIntent(
  input: OrderIntentInput,
): Promise<OrderIntentResult> {
  const db = getDb();

  const shop = await db.query.shops.findFirst({
    where: and(eq(shops.id, input.shopId), eq(shops.isPublished, true)),
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
  let coupon: Coupon | null = null;

  if (input.couponCode?.trim()) {
    const code = normalizeCode(input.couponCode);
    const found = await db.query.coupons.findFirst({
      where: and(eq(coupons.shopId, shop.id), eq(coupons.code, code)),
    });
    const verdict = checkCoupon(found, subtotalCents, now);
    if (!verdict.ok) {
      return { ok: false, error: COUPON_MESSAGES[verdict.reason] };
    }
    coupon = found!;
  }

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

  const commissionBp = affiliate
    ? (affiliate.commissionBp ?? shop.affiliateDefaultBp)
    : null;

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

  const email = clean(input.customerEmail, 160)?.toLowerCase() ?? null;
  const phoneRaw = clean(input.customerPhone, 40);
  const phone = phoneRaw ? normalizePhone(phoneRaw) || null : null;

  // Manual rails settle later, so we need a way to reach the buyer.
  // What the rail needs, read from the rail rather than inferred from its kind.
  if (def.requires.email && !email) {
    return {
      ok: false,
      error: "Add your email so we can send your receipt.",
    };
  }
  if (def.requires.contact && !email && !phone) {
    return {
      ok: false,
      error: "Add an email or phone number so the seller can reach you.",
    };
  }

  // A collection order has no delivery address to store.
  const address = wantsAddress
    ? {
        addressLine1: clean(input.addressLine1, 200),
        addressLine2: clean(input.addressLine2, 200),
        city: clean(input.city, 100),
        region: clean(input.region, 100),
        postalCode: clean(input.postalCode, 32),
        country: clean(input.country, 100),
      }
    : {
        addressLine1: null,
        addressLine2: null,
        city: null,
        region: null,
        postalCode: null,
        country: null,
      };

  const name = clean(input.customerName, 120);
  const note = clean(input.note, 500);

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

    for (const undo of taken) {
      await releaseStock({
        productId: undo.productId,
        variantId: undo.variantId,
        quantity: undo.quantity,
      });
    }
    return {
      ok: false,
      error:
        line.quantity > 1
          ? `There isn't that much ${line.title} left. Try a smaller quantity.`
          : `${line.title} just sold out.`,
    };
  }

  /* ---- Digital delivery ------------------------------------------------ */

  // One link per order covering every downloadable line in it. The strictest
  // rule wins: if any file is held until payment, none of them open early.
  const digitalLines = [];
  for (const line of lines) {
    if (line.kind !== "digital") continue;
    if (await hasDeliverableFiles(line.productId)) digitalLines.push(line);
  }

  const deliversFiles = digitalLines.length > 0;
  const unlockNow =
    deliversFiles &&
    digitalLines.every((line) =>
      releasesImmediately(line.product, {
        totalCents: totals.totalCents,
        paymentStatus: "unpaid",
      }),
    );
  const downloadToken = deliversFiles ? newDownloadToken() : null;
  // The shortest window and the tightest cap, so no line outlives its terms.
  const downloadExpiresAt = deliversFiles
    ? soonest(
        digitalLines.map((l) => downloadExpiry(l.product.downloadExpiryDays, now)),
      )
    : null;
  const downloadLimit = deliversFiles
    ? smallest(digitalLines.map((l) => l.product.downloadLimit))
    : null;

  const order = firstRow(await db
    .insert(orders)
    .values({
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
    .returning({ id: orders.id }), "order");

  // The authoritative list of what was sold. Written straight after the header
  // so nothing can read the order in a one-line-only state.
  await db.insert(orderItems).values(
    priced.lines.map((line, position) => ({
      orderId: order.id,
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
  );

  // Redemptions are counted atomically so a usage cap can't be overshot.
  if (coupon) {
    await db
      .update(coupons)
      .set({ timesRedeemed: sql`${coupons.timesRedeemed} + 1` })
      .where(eq(coupons.id, coupon.id));
  }

  const invoice = await createInvoiceForOrder(shop.id, order.id);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";

  // Confirmation email — best effort, never blocks or fails the order.
  if (email) {
    const saved = await db.query.orders.findFirst({
      where: eq(orders.id, order.id),
    });
    if (saved) {
      const result = await sendOrderConfirmation({
        shop,
        order: saved,
        items: await db.query.orderItems.findMany({
          where: eq(orderItems.orderId, order.id),
          orderBy: [asc(orderItems.position)],
        }),
        invoiceUrl: invoice && base ? `${base}/invoice/${invoice.token}` : null,
        invoiceNumber: invoice?.number ?? null,
        downloadUrl:
          unlockNow && downloadToken ? downloadUrl(downloadToken, base) : null,
        downloadPending: deliversFiles && !unlockNow,
      });
      if (result.sent) {
        await db
          .update(orders)
          .set({ confirmationSentAt: new Date() })
          .where(eq(orders.id, order.id));
      } else {
        console.warn(`[sailo] order email not sent: ${result.reason}`);
      }
    }
  }

  // Buyers who leave an email can be offered their own referral link.
  const referral =
    affiliatesLive && email
      ? await referralFor(shop, name, email, base)
      : null;

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/invoices");

  let handoff = buildHandoff(method.type, method.config, {
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

  /* ---- Card: hand the buyer to Stripe --------------------------------- */

  // Only reachable once the order row exists — the session carries its id so
  // the webhook can find it, and the amounts come from the row rather than
  // from anything the client sent.
  if (method.type === "card") {
    // The insert returns only an id; the session and the rollback both need
    // the full row, so read it back once here rather than widening every
    // other caller's return.
    const saved = await db.query.orders.findFirst({
      where: eq(orders.id, order.id),
    });
    if (!saved) return { ok: false, error: "Couldn't start the payment." };

    try {
      const session = await createCheckoutSession({
        shop,
        order: saved,
        // Stripe's receipt itemises the basket rather than lumping it under
        // the first product's name.
        items: priced.lines.map((line) => ({
          name: line.label ? `${line.title} — ${line.label}` : line.title,
          unitPriceCents: line.unitPriceCents,
          quantity: line.quantity,
        })),
        successUrl: invoice
          ? `${base}/invoice/${invoice.token}?paid=1`
          : `${base}/${shop.handle}?ordered=1`,
        cancelUrl:
          lines.length === 1
            ? `${base}/${shop.handle}/p/${head.product.slug}?cancelled=1`
            : `${base}/${shop.handle}?cancelled=1`,
      });

      await db
        .update(orders)
        .set({
          stripeSessionId: session.id,
          stripeAccountId: shop.stripeAccountId,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      if (!session.url) throw new Error("Stripe returned no checkout URL");
      handoff = { kind: "redirect", url: session.url };
    } catch (error) {
      // The order and its stock reservation already exist. Rolling both back
      // is the only honest outcome: leaving an unpayable order would hold
      // stock the seller could otherwise sell.
      await restoreStock(saved);
      await db.delete(orders).where(eq(orders.id, order.id));

      console.error("[sailo] stripe checkout session failed", error);
      return {
        ok: false,
        error:
          "Card payment isn't available right now. Try another way to order.",
      };
    }
  }

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
        ...[
          ...new Set(
            lines
              .filter((l) => l.kind === "service" && l.product.serviceLocation)
              .map((l) => l.product.serviceLocation!.trim()),
          ),
        ],
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
  const db = getDb();
  const now = new Date();

  const shop = await db.query.shops.findFirst({
    where: and(eq(shops.id, input.shopId), eq(shops.isPublished, true)),
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
    if (verdict.ok) {
      coupon = found!;
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
  const reference = input.reference.trim().slice(0, 200);
  if (!reference) return { ok: false, error: "Add the transfer reference." };

  const db = getDb();
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, input.orderId),
    columns: { id: true, paymentStatus: true },
  });
  if (!order) return { ok: false, error: "Order not found." };
  // Only an unconfirmed order may be updated from the public side.
  if (order.paymentStatus === "paid") {
    return { ok: false, error: "This order is already marked paid." };
  }

  await db
    .update(orders)
    .set({ paymentReference: reference, paymentStatus: "pending", updatedAt: new Date() })
    .where(eq(orders.id, input.orderId));

  revalidatePath("/admin/orders");
  return { ok: true };
}
