"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  affiliates,
  clients,
  coupons,
  deliveryMethods,
  orders,
  paymentMethods,
  products,
  shops,
  type Affiliate,
  type Coupon,
  type PaymentConfig,
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
  isConfigured,
  isPaymentMethodType,
  PAYMENT_METHOD_DEFS,
  type Handoff,
} from "@/lib/payments";
import { isDeliveryConfigured } from "@/lib/delivery";
import {
  checkCoupon,
  computeTotals,
  COUPON_MESSAGES,
  formatPercent,
  generateCode,
  normalizeCode,
  type Totals,
} from "@/lib/pricing";
import { createInvoiceForOrder } from "@/lib/invoices";
import { can } from "@/lib/plans";

// A "use server" module may only export async functions, so this stays local.
const ORDER_STATUSES = new Set([
  "new",
  "confirmed",
  "shipped",
  "completed",
  "cancelled",
  "refunded",
]);
const PAYMENT_STATUSES = new Set(["unpaid", "pending", "paid", "refunded"]);

export type OrderAddress = {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

export type OrderIntentInput = {
  shopId: string;
  productId: string;
  quantity: number;
  paymentMethod: string;
  deliveryMethodId?: string;
  couponCode?: string;
  affiliateCode?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  note?: string;
} & OrderAddress;

export type OrderIntentResult =
  | {
      ok: true;
      orderId: string;
      handoff: Handoff | null;
      /** Populated for bank transfer so the buyer can pay. */
      bankDetails?: { label: string; value: string }[];
      instructions?: string;
      methodName: string;
      totals: Totals;
      currency: string;
      invoiceUrl: string | null;
      invoiceNumber: string | null;
      /** Present when the shop runs a referral programme. */
      referral: { code: string; url: string; percent: string } | null;
    }
  | { ok: false; error: string };

function clean(value: string | undefined, max: number) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Matches an existing client on email or phone, otherwise creates one. Address
 * fields are refreshed on every order so the profile reflects the latest
 * delivery details the buyer gave.
 */
async function upsertClient(
  shopId: string,
  data: {
    name: string | null;
    email: string | null;
    phone: string | null;
  } & Record<string, string | null>,
) {
  const db = getDb();
  if (!data.email && !data.phone) return null;

  const matchers = [];
  if (data.email) matchers.push(eq(clients.email, data.email));
  if (data.phone) matchers.push(eq(clients.phone, data.phone));
  const match = matchers.length === 1 ? matchers[0] : or(...matchers);

  const existing = await db.query.clients.findFirst({
    where: and(eq(clients.shopId, shopId), match),
  });

  const address = {
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2,
    city: data.city,
    region: data.region,
    postalCode: data.postalCode,
    country: data.country,
  };
  // Don't blank out a stored address when this order didn't collect one.
  const addressUpdate = Object.fromEntries(
    Object.entries(address).filter(([, v]) => v !== null),
  );

  if (existing) {
    await db
      .update(clients)
      .set({
        name: data.name ?? existing.name,
        email: data.email ?? existing.email,
        phone: data.phone ?? existing.phone,
        ...addressUpdate,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, existing.id));
    return existing.id;
  }

  const [created] = await db
    .insert(clients)
    .values({
      shopId,
      name: data.name ?? "Anonymous",
      email: data.email,
      phone: data.phone,
      ...address,
    })
    .returning({ id: clients.id });
  return created.id;
}

/**
 * Called from the public shop the moment a buyer commits. Persists the lead
 * first, then returns the next step for the rail they chose.
 */
export async function createOrderIntent(
  input: OrderIntentInput,
): Promise<OrderIntentResult> {
  const db = getDb();

  const shop = await db.query.shops.findFirst({
    where: and(eq(shops.id, input.shopId), eq(shops.isPublished, true)),
  });
  if (!shop) return { ok: false, error: "Shop not found." };

  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, input.productId),
      eq(products.shopId, shop.id),
      eq(products.isPublished, true),
    ),
  });
  if (!product) return { ok: false, error: "Product not available." };
  if (!product.inStock) return { ok: false, error: "This item is sold out." };

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
  if (!method || !isConfigured(method.type, method.config)) {
    return { ok: false, error: "That option isn't available right now." };
  }

  const def = PAYMENT_METHOD_DEFS[input.paymentMethod];
  const quantity = Math.min(Math.max(Math.trunc(input.quantity) || 1, 1), 999);
  const now = new Date();

  /* ---- Delivery ------------------------------------------------------- */

  // Only physical goods are delivered; digital and services skip it entirely.
  const needsDelivery = product.kind === "physical";
  let delivery: Awaited<
    ReturnType<typeof db.query.deliveryMethods.findFirst>
  > = undefined;

  if (needsDelivery) {
    const available = (
      await db.query.deliveryMethods.findMany({
        where: and(
          eq(deliveryMethods.shopId, shop.id),
          eq(deliveryMethods.isEnabled, true),
        ),
        orderBy: [asc(deliveryMethods.position)],
      })
    ).filter((d) => isDeliveryConfigured(d.type, d.config));

    if (available.length > 0) {
      delivery = input.deliveryMethodId
        ? available.find((d) => d.id === input.deliveryMethodId)
        : available[0];
      if (!delivery) {
        return { ok: false, error: "Pick how you'd like to receive it." };
      }
    }
  }

  const wantsAddress =
    needsDelivery &&
    shop.collectAddress &&
    (!delivery || delivery.type === "shipping");

  /* ---- Coupon --------------------------------------------------------- */

  const subtotalCents = product.priceCents * quantity;
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

  const totals = computeTotals({
    unitPriceCents: product.priceCents,
    quantity,
    coupon,
    deliveryMethod: delivery,
    commissionBp,
    tax: shop,
    now,
  });

  const email = clean(input.customerEmail, 160)?.toLowerCase() ?? null;
  const phoneRaw = clean(input.customerPhone, 40);
  const phone = phoneRaw ? normalizePhone(phoneRaw) || null : null;

  // Manual rails settle later, so we need a way to reach the buyer.
  if (def.kind === "manual" && !email && !phone) {
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

  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      productId: product.id,
      clientId,
      productTitle: product.title,
      unitPriceCents: product.priceCents,
      quantity,
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
    .returning({ id: orders.id });

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
        invoiceUrl: invoice && base ? `${base}/invoice/${invoice.token}` : null,
        invoiceNumber: invoice?.number ?? null,
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

  const handoff = buildHandoff(method.type, method.config, {
    shopName: shop.name,
    productTitle: product.title,
    quantity,
    priceLabel: formatMoney(totals.totalCents, shop.currency),
    productUrl: base ? `${base}/${shop.handle}/p/${product.slug}` : undefined,
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
    referral,
    bankDetails:
      method.type === "bank_transfer" ? bankDetailLines(config) : undefined,
    instructions:
      [config.instructions?.trim(), deliveryInstructions.trim()]
        .filter(Boolean)
        .join("\n\n") || undefined,
  };
}

/** What the order sheet needs to label the tax line, or null when tax is off. */
export type PreviewTax = {
  name: string;
  rateBp: number;
  inclusive: boolean;
} | null;

export type OrderPreview = {
  totals: Totals;
  currency: string;
  tax: PreviewTax;
  couponError?: string;
  couponApplied?: string;
};

/**
 * Recomputes totals for the order sheet as the buyer changes quantity,
 * delivery or coupon. Uses the same `computeTotals` as the real order, so the
 * quoted price can't drift from the charged one.
 */
export async function previewOrder(input: {
  shopId: string;
  productId: string;
  quantity: number;
  deliveryMethodId?: string;
  couponCode?: string;
}): Promise<OrderPreview | { error: string }> {
  const db = getDb();

  const shop = await db.query.shops.findFirst({
    where: and(eq(shops.id, input.shopId), eq(shops.isPublished, true)),
    columns: {
      id: true,
      currency: true,
      taxEnabled: true,
      taxName: true,
      taxRateBp: true,
      taxInclusive: true,
      taxOnDelivery: true,
    },
  });
  if (!shop) return { error: "Shop not found." };

  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, input.productId),
      eq(products.shopId, shop.id),
      eq(products.isPublished, true),
    ),
    columns: { priceCents: true, kind: true },
  });
  if (!product) return { error: "Product not available." };

  const quantity = Math.min(Math.max(Math.trunc(input.quantity) || 1, 1), 999);

  const delivery =
    product.kind === "physical" && input.deliveryMethodId
      ? await db.query.deliveryMethods.findFirst({
          where: and(
            eq(deliveryMethods.shopId, shop.id),
            eq(deliveryMethods.id, input.deliveryMethodId),
            eq(deliveryMethods.isEnabled, true),
          ),
        })
      : undefined;

  let coupon: Coupon | null = null;
  let couponError: string | undefined;
  let couponApplied: string | undefined;

  if (input.couponCode?.trim()) {
    const code = normalizeCode(input.couponCode);
    const found = await db.query.coupons.findFirst({
      where: and(eq(coupons.shopId, shop.id), eq(coupons.code, code)),
    });
    const verdict = checkCoupon(found, product.priceCents * quantity, new Date());
    if (verdict.ok) {
      coupon = found!;
      couponApplied = code;
    } else {
      couponError = COUPON_MESSAGES[verdict.reason];
    }
  }

  return {
    totals: computeTotals({
      unitPriceCents: product.priceCents,
      quantity,
      coupon,
      deliveryMethod: delivery,
      tax: shop,
    }),
    currency: shop.currency,
    tax: shop.taxEnabled
      ? {
          name: shop.taxName,
          rateBp: shop.taxRateBp,
          inclusive: shop.taxInclusive,
        }
      : null,
    couponError,
    couponApplied,
  };
}

/**
 * Finds or creates the buyer's own referral code so they can share the shop
 * after ordering. Buyer-sourced affiliates start active — the seller can
 * disable them from the admin.
 */
async function referralFor(
  shop: Shop,
  name: string | null,
  email: string,
  base: string,
) {
  const db = getDb();

  let affiliate = await db.query.affiliates.findFirst({
    where: and(eq(affiliates.shopId, shop.id), eq(affiliates.email, email)),
  });

  if (!affiliate) {
    // Retry on the rare code collision rather than failing the order.
    for (let attempt = 0; attempt < 5 && !affiliate; attempt++) {
      const [created] = await db
        .insert(affiliates)
        .values({
          shopId: shop.id,
          name: name ?? email.split("@")[0],
          email,
          code: generateCode(name ?? email.split("@")[0]),
          status: "active",
          source: "buyer",
        })
        .onConflictDoNothing({ target: [affiliates.shopId, affiliates.code] })
        .returning();
      affiliate = created;
    }
  }

  if (!affiliate || affiliate.status !== "active") return null;

  return {
    code: affiliate.code,
    url: `${base}/${shop.handle}?ref=${affiliate.code}`,
    percent: formatPercent(affiliate.commissionBp ?? shop.affiliateDefaultBp),
  };
}

/**
 * Buyer submits the reference for a transfer they've already sent. Moves the
 * order to `pending` for the seller to confirm.
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

/* -------------------------------------------------------------------------- */
/*  Admin                                                                      */
/* -------------------------------------------------------------------------- */

export async function updateOrderStatus(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !ORDER_STATUSES.has(status)) return;

  await getDb()
    .update(orders)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.shopId, shop.id)));

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
}

export async function updatePaymentStatus(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  const paymentStatus = String(formData.get("paymentStatus") ?? "");
  if (!id || !PAYMENT_STATUSES.has(paymentStatus)) return;

  await getDb()
    .update(orders)
    .set({ paymentStatus, updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.shopId, shop.id)));

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

  const updated = await db.query.orders.findFirst({ where: eq(orders.id, id) });
  let note = `Refunded ${formatMoney(requested, order.currency)}.`;
  if (updated?.customerEmail) {
    const result = await sendRefundNotification({ shop, order: updated });
    if (!result.sent) note += ` Email failed: ${result.reason}`;
  }

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  return { ok: true, message: note };
}

/** Undoes a refund, e.g. one entered by mistake. */
export async function clearRefund(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .update(orders)
    .set({
      refundedCents: 0,
      refundedAt: null,
      refundReason: null,
      status: "confirmed",
      paymentStatus: "paid",
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, id), eq(orders.shopId, shop.id)));

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
}

export async function deleteOrder(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await getDb()
    .delete(orders)
    .where(and(eq(orders.id, id), eq(orders.shopId, shop.id)));

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
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
