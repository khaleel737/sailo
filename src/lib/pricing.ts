import type { Coupon, DeliveryMethod } from "@/db/schema";

/**
 * Percentages are stored in basis points so fractional rates (7.5%) survive a
 * round trip. 1000 bp = 10%.
 */
export function bpToPercent(bp: number) {
  return bp / 100;
}

export function percentToBp(percent: number) {
  return Math.round(percent * 100);
}

/** Formats a basis-point rate without trailing zeros: 1000 → "10", 750 → "7.5". */
export function formatPercent(bp: number) {
  return String(Number(bpToPercent(bp).toFixed(2)));
}

export type CouponFailure =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "used_up"
  | "below_minimum";

export const COUPON_MESSAGES: Record<CouponFailure, string> = {
  not_found: "That code isn't valid.",
  inactive: "That code isn't active.",
  not_started: "That code isn't available yet.",
  expired: "That code has expired.",
  used_up: "That code has been fully redeemed.",
  below_minimum: "Your order is below the minimum for that code.",
};

/**
 * Pure coupon check. `now` is injected so the caller controls the clock and
 * this stays testable.
 */
export function checkCoupon(
  coupon: Coupon | null | undefined,
  subtotalCents: number,
  now: Date,
): { ok: true; discountCents: number } | { ok: false; reason: CouponFailure } {
  if (!coupon) return { ok: false, reason: "not_found" };
  if (!coupon.isActive) return { ok: false, reason: "inactive" };
  if (coupon.startsAt && coupon.startsAt > now)
    return { ok: false, reason: "not_started" };
  if (coupon.expiresAt && coupon.expiresAt <= now)
    return { ok: false, reason: "expired" };
  if (
    coupon.maxRedemptions !== null &&
    coupon.timesRedeemed >= coupon.maxRedemptions
  )
    return { ok: false, reason: "used_up" };
  if (subtotalCents < coupon.minSubtotalCents)
    return { ok: false, reason: "below_minimum" };

  return { ok: true, discountCents: couponDiscount(coupon, subtotalCents) };
}

/** Never discounts more than the subtotal. */
export function couponDiscount(coupon: Coupon, subtotalCents: number) {
  const raw =
    coupon.discountType === "percent"
      ? Math.round((subtotalCents * coupon.discountValue) / 10_000)
      : coupon.discountValue;
  return Math.max(0, Math.min(raw, subtotalCents));
}

/** Free-over threshold is checked against the discounted subtotal. */
export function deliveryFee(
  method: Pick<DeliveryMethod, "feeCents" | "freeOverCents"> | null | undefined,
  netCents: number,
) {
  if (!method) return 0;
  if (method.freeOverCents !== null && netCents >= method.freeOverCents) return 0;
  return Math.max(0, method.feeCents);
}

/** Commission is earned on goods only, never on the delivery fee. */
export function commission(netCents: number, bp: number) {
  return Math.max(0, Math.round((netCents * bp) / 10_000));
}

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  commissionCents: number;
};

export function computeTotals(input: {
  unitPriceCents: number;
  quantity: number;
  coupon?: Coupon | null;
  deliveryMethod?: Pick<DeliveryMethod, "feeCents" | "freeOverCents"> | null;
  commissionBp?: number | null;
  now?: Date;
}): Totals {
  const subtotalCents = Math.max(0, input.unitPriceCents * input.quantity);

  const couponResult = input.coupon
    ? checkCoupon(input.coupon, subtotalCents, input.now ?? new Date())
    : null;
  const discountCents = couponResult?.ok ? couponResult.discountCents : 0;

  const netCents = subtotalCents - discountCents;
  const deliveryFeeCents = deliveryFee(input.deliveryMethod, netCents);

  return {
    subtotalCents,
    discountCents,
    deliveryFeeCents,
    totalCents: netCents + deliveryFeeCents,
    commissionCents: input.commissionBp
      ? commission(netCents, input.commissionBp)
      : 0,
  };
}

/** Uppercased, trimmed, no spaces — how coupon and affiliate codes are stored. */
export function normalizeCode(input: string) {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

/** Readable random code for affiliates — no ambiguous characters. */
export function generateCode(seed: string) {
  const base = normalizeCode(seed).slice(0, 10) || "REF";
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let suffix = "";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  return `${base}${suffix}`;
}
