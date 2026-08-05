"use server";

import { revalidatePath } from "next/cache";
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

/** One thing the buyer wants, as the browser asks for it. */
export type OrderLineInput = {
  productId: string;
  /** Which combination of the product's options the buyer picked. */
  variantId?: string;
  quantity: number;
  /** ISO instant from the booking picker, for a service line. */
  scheduledFor?: string;
};

export type OrderIntentInput = {
  shopId: string;
  /** One line for "buy now", several for a cart. */
  items: OrderLineInput[];
  paymentMethod: string;
  deliveryMethodId?: string;
  couponCode?: string;
  affiliateCode?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  note?: string;
} & OrderAddress;

/** Past this a "cart" is a data-entry mistake, not a shopping trip. */
const MAX_LINES = 50;

type ResolvedLine = QuoteLine & {
  product: Product;
  variant: ProductVariant | null;
  scheduledFor: Date | null;
};

/**
 * Turns what the browser asked for into what the shop will actually sell:
 * real products, real variants, real prices. Nothing the client sent about
 * money survives this function.
 *
 * `strict` fails the whole order on the first unusable line — right when a
 * buyer is committing. The cart preview is lenient instead, dropping bad lines
 * so the rest of the basket still prices.
 */
async function resolveLines(
  shopId: string,
  items: OrderLineInput[],
  opts: { strict: boolean; now: Date },
): Promise<
  | { ok: true; lines: ResolvedLine[]; dropped: OrderLineInput[] }
  | { ok: false; error: string }
> {
  const db = getDb();
  const lines: ResolvedLine[] = [];
  const dropped: OrderLineInput[] = [];

  if (items.length === 0) return { ok: false, error: "Your basket is empty." };

  const fail = (line: OrderLineInput, error: string) => {
    if (opts.strict) return { ok: false as const, error };
    dropped.push(line);
    return null;
  };

  for (const item of items.slice(0, MAX_LINES)) {
    const product = await db.query.products.findFirst({
      where: and(
        eq(products.id, item.productId),
        eq(products.shopId, shopId),
        eq(products.isPublished, true),
      ),
    });
    if (!product) {
      const stop = fail(item, "Product not available.");
      if (stop) return stop;
      continue;
    }

    const variants = await db.query.productVariants.findMany({
      where: eq(productVariants.productId, product.id),
      orderBy: [asc(productVariants.position)],
    });

    let variant: ProductVariant | null = null;
    if (variants.length > 0) {
      variant = variants.find((v) => v.id === item.variantId) ?? null;
      if (!variant) {
        const what = product.options[0]?.name?.toLowerCase() ?? "option";
        const stop = fail(item, `Choose a ${what} for ${product.title}.`);
        if (stop) return stop;
        continue;
      }
    }

    if (!isSellable(product, variant)) {
      const stop = fail(item, `${product.title} is sold out.`);
      if (stop) return stop;
      continue;
    }

    // A service books its own slot, against its own notice period.
    let scheduledFor: Date | null = null;
    if (product.kind === "service" && product.bookingEnabled) {
      scheduledFor = parseBooking(
        item.scheduledFor,
        product.bookingLeadHours,
        opts.now,
      );
      if (item.scheduledFor?.trim() && !scheduledFor) {
        const stop = fail(
          item,
          `Pick a time for ${product.title} at least ${product.bookingLeadHours} hours from now.`,
        );
        if (stop) return stop;
        continue;
      }
    }

    const quantity = clampQuantity(item.quantity, maxOrderable(product, variant));

    lines.push({
      productId: product.id,
      variantId: variant?.id ?? null,
      title: product.title,
      kind: product.kind,
      options: product.options,
      variantOptions: variant?.options ?? null,
      sku: variant?.sku ?? null,
      imageUrl: variant?.imageUrl ?? null,
      // The price the buyer is charged comes from the variant they picked.
      unitPriceCents: variantPrice(product, variant),
      quantity,
      product,
      variant,
      scheduledFor,
    });
  }

  if (lines.length === 0) {
    return { ok: false, error: "Nothing in your basket is available right now." };
  }
  return { ok: true, lines, dropped };
}

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
      /** Set when a digital order's files are already unlocked. */
      downloadUrl: string | null;
      /** Set when they unlock once the seller confirms payment. */
      downloadPending: boolean;
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

  const created = firstRow(await db
    .insert(clients)
    .values({
      shopId,
      name: data.name ?? "Anonymous",
      email: data.email,
      phone: data.phone,
      ...address,
    })
    .returning({ id: clients.id }), "created");
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
async function resolveDelivery(
  shopId: string,
  needed: boolean,
  requestedId: string | undefined,
) {
  if (!needed) return undefined;
  const db = getDb();

  const available = (
    await db.query.deliveryMethods.findMany({
      where: and(
        eq(deliveryMethods.shopId, shopId),
        eq(deliveryMethods.isEnabled, true),
      ),
      orderBy: [asc(deliveryMethods.position)],
    })
  ).filter((d) => isDeliveryConfigured(d.type, d.config));

  if (available.length === 0) return undefined;
  if (!requestedId) return available[0];
  return available.find((d) => d.id === requestedId) ?? ("unavailable" as const);
}

/** The earliest of several deadlines, ignoring the ones that never expire. */
function soonest(dates: (Date | null)[]): Date | null {
  const real = dates.filter((d): d is Date => d !== null);
  if (real.length === 0) return null;
  return real.reduce((min, d) => (d < min ? d : min));
}

/** The tightest of several caps, ignoring the ones that are uncapped. */
function smallest(limits: (number | null)[]): number | null {
  const real = limits.filter((n): n is number => n !== null);
  if (real.length === 0) return null;
  return Math.min(...real);
}

/**
 * Reads the booking picker's local datetime. Anything earlier than the notice
 * the seller asked for is rejected rather than quietly rounded up — a buyer
 * who picked 9am tomorrow should be told it's too soon, not booked for Friday.
 */
function parseBooking(
  value: string | undefined,
  leadHours: number,
  now: Date,
): Date | null {
  if (!value?.trim()) return null;

  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return null;

  const earliest = new Date(now.getTime() + Math.max(0, leadHours) * 3_600_000);
  if (when < earliest) return null;

  // A year out is a typo, not a booking.
  const latest = new Date(now.getTime() + 365 * 24 * 3_600_000);
  if (when > latest) return null;

  return when;
}

/** What the order sheet needs to label the tax line, or null when tax is off. */
export type PreviewTax = {
  name: string;
  rateBp: number;
  inclusive: boolean;
} | null;

/** A priced line, as the cart draws it. */
export type PreviewLine = {
  productId: string;
  variantId: string | null;
  title: string;
  label: string;
  kind: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
  /** Units left, or null when nobody is counting. */
  unitsLeft: number | null;
};

export type OrderPreview = {
  totals: Totals;
  currency: string;
  tax: PreviewTax;
  lines: PreviewLine[];
  /** Lines that have gone since they were added, so the cart can say so. */
  unavailable: { productId: string; variantId: string | null }[];
  needsDelivery: boolean;
  needsAddress: boolean;
  hasService: boolean;
  couponError?: string;
  couponApplied?: string;
};

/**
 * Prices a basket for the checkout panel as the buyer changes quantity,
 * delivery or coupon. It runs the same `resolveLines` and `quote` as the real
 * order, so what's shown can't drift from what's charged — and it's lenient,
 * so one sold-out line doesn't blank the whole cart.
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
      const localPart = email.split("@")[0] ?? email;
      const created = firstRow(await db
        .insert(affiliates)
        .values({
          shopId: shop.id,
          name: name ?? localPart,
          email,
          code: generateCode(name ?? localPart),
          status: "active",
          source: "buyer",
        })
        .onConflictDoNothing({ target: [affiliates.shopId, affiliates.code] })
        .returning(), "created");
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
