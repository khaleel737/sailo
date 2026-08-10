"use server";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { liveShop } from "@/lib/shop-visibility";
import { coupons, shops, type Coupon } from "@/db/schema";
import { rateLimit, refundRateLimit } from "@/lib/redis";
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
    where: liveShop(eq(shops.id, input.shopId)),
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
    // The same rounding the order will use, so the total a buyer is quoted is
    // the total they are charged.
    currency: shop.currency,
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
    /*
     * A ceiling on *wrong* guesses, separate from the one on quotes.
     *
     * The general quote limit is 120 a minute because the basket re-prices on
     * every keystroke — which also meant 120 coupon guesses a minute, and the
     * reply distinguishes "no such code" from "that code does not apply here".
     * A working discount code is a bearer token: anyone who finds one can
     * spend it.
     *
     * Only a miss costs, and that is the whole design rather than a nicety.
     * Charging every lookup rations the honest buyer hardest: their code stays
     * in the basket, so it is re-checked on every keystroke, quantity change
     * and address edit, and a ceiling of ten was gone in seconds — after which
     * their perfectly good code came back `not_found` and the discount
     * vanished from a checkout they were part-way through. Charging only for
     * codes that do not exist rations the one behaviour that separates
     * guessing from using, and leaves re-quoting a real code free.
     *
     * Paid up front and refunded on a hit, not peeked and charged on a miss.
     * The peek version had a hole precisely where this ceiling aims: a burst
     * of concurrent guesses all read the counter before any of them wrote it,
     * and the whole burst went through a budget of ten. `INCR` first makes the
     * verdict atomic — of any burst, only what the budget covers reaches the
     * lookup — and a real code hands its unit straight back, so the honest
     * buyer's balance never drifts however often the basket re-prices.
     *
     * Answered as `not_found` when tripped, so the ceiling itself says nothing
     * about whether the code was real. A code that exists but does not apply
     * (expired, under minimum) also refunds: existence is the secret being
     * guarded, and the buyer holding such a code is not guessing.
     */
    const guessKey = `coupon:${await callerIp()}`;
    const budget = await rateLimit(guessKey, 10, 300);

    const code = normalizeCode(input.couponCode);
    // Not looked up at all once the ceiling is reached, so the ceiling costs a
    // query as well as saying nothing.
    const found = budget.allowed
      ? await db.query.coupons.findFirst({
          where: and(eq(coupons.shopId, shop.id), eq(coupons.code, code)),
        })
      : undefined;
    if (found) await refundRateLimit(guessKey, 300);
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
