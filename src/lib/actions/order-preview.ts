"use server";

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { coupons, shops, type Coupon } from "@/db/schema";
import { rateLimit } from "@/lib/redis";
import { callerIp } from "@/lib/client-ip";
import { resolveLines } from "@/lib/orders/resolve-lines";
import { resolveDelivery } from "@/lib/orders/delivery";
import { cartNeedsDelivery, cartSubtotal, quote } from "@/lib/quote";
import { checkCoupon, COUPON_MESSAGES, normalizeCode } from "@/lib/pricing";
import { unitsLeft } from "@/lib/variants";
import type { OrderLineInput, OrderPreview } from "@/lib/orders/types";

/**
 * Pricing a basket without committing to it.
 *
 * Split out of `orders.ts` because it is the one action there that writes
 * nothing. It runs on every keystroke in the coupon field, takes no stock,
 * claims no redemption and creates no row — so it is lenient where
 * `createOrderIntent` is strict: a line that has since sold out is dropped
 * from the quote rather than failing it, because the buyer is still shopping.
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
