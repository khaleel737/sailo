import type { Coupon, DeliveryMethod } from "@sailo/db/schema";
import { chargeStep } from "@/lib/currency";

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

/** The shop-level tax settings, as `computeTotals` needs them. */
export type TaxSettings = {
  taxEnabled: boolean;
  taxName: string;
  taxRateBp: number;
  taxInclusive: boolean;
  taxOnDelivery: boolean;
};

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
  commissionCents: number;
};

/**
 * How much tax sits on a given base.
 *
 * The two conventions are genuinely different sums, not a display choice:
 *
 * - **Exclusive** (US sales tax): the price is pre-tax and tax is added, so
 *   `base × rate`. A $100 item at 20% becomes $120.
 * - **Inclusive** (EU VAT, UK, most of Asia): the price the buyer already saw
 *   contains the tax, so the tax is *extracted* with `base × rate / (1 + rate)`.
 *   A £100 item at 20% is £83.33 + £16.67, still £100. Multiplying by the rate
 *   here would over-report by a sixth and hand the seller a wrong VAT return.
 */
export function taxOn(baseCents: number, rateBp: number, inclusive: boolean) {
  if (baseCents <= 0 || rateBp <= 0) return 0;
  return inclusive
    ? Math.round((baseCents * rateBp) / (10_000 + rateBp))
    : Math.round((baseCents * rateBp) / 10_000);
}

export function computeTotals(input: {
  /** The goods, already summed — one line or a whole cart. */
  subtotalCents: number;
  coupon?: Coupon | null;
  deliveryMethod?: Pick<DeliveryMethod, "feeCents" | "freeOverCents"> | null;
  commissionBp?: number | null;
  tax?: TaxSettings | null;
  now?: Date;
}): Totals {
  const subtotalCents = Math.max(0, input.subtotalCents);

  const couponResult = input.coupon
    ? checkCoupon(input.coupon, subtotalCents, input.now ?? new Date())
    : null;
  const discountCents = couponResult?.ok ? couponResult.discountCents : 0;

  const netCents = subtotalCents - discountCents;
  const deliveryFeeCents = deliveryFee(input.deliveryMethod, netCents);

  /*
   * Bound once, so "is tax charged here" and "what rate" cannot disagree.
   *
   * Computing the taxable base under a guard and then reading the rate through
   * `tax!` meant two separate claims about the same fact — and the assertion
   * would have thrown on the day they diverged.
   */
  const tax =
    input.tax?.taxEnabled && input.tax.taxRateBp > 0 ? input.tax : null;

  const taxable = tax
    ? netCents + (tax.taxOnDelivery ? deliveryFeeCents : 0)
    : 0;
  const taxCents = tax ? taxOn(taxable, tax.taxRateBp, tax.taxInclusive) : 0;

  // Inclusive tax is already inside the prices, so it must not be added again.
  const totalCents =
    netCents + deliveryFeeCents + (tax?.taxInclusive ? 0 : taxCents);

  // An affiliate earns on the goods, never on tax the seller merely collects
  // and remits, nor on delivery. With inclusive pricing the tax is hidden
  // inside `netCents`, so strip it out before paying commission on it.
  const goodsTaxCents =
    tax?.taxInclusive ? taxOn(netCents, tax.taxRateBp, true) : 0;

  return {
    subtotalCents,
    discountCents,
    deliveryFeeCents,
    taxCents,
    totalCents,
    commissionCents: input.commissionBp
      ? commission(netCents - goodsTaxCents, input.commissionBp)
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

/**
 * An order priced in an amount a card can actually settle.
 *
 * The three-decimal currencies — KWD, BHD, JOD, OMR, TND — settle to two
 * places, so a total of 12.345 KWD is not chargeable: Stripe refuses any
 * amount that is not a multiple of ten fils. `toStripeAmount` rounded each
 * *line* on the way out, which meant the card was asked for something the
 * order had never said, and the guard that was supposed to catch that compared
 * the unrounded numbers and passed. A buyer's statement and their invoice
 * disagreed by up to five fils per line, with nothing in either to explain it.
 *
 * Rounding at the Stripe boundary cannot fix that, because the invoice is
 * written from the order. So the order is rounded instead, and the invoice,
 * the total the buyer agreed to and the amount charged are the same number by
 * construction.
 *
 * The parts are rounded and the total re-derived from them, rather than the
 * total rounded on its own — a receipt whose lines do not add up to its total
 * is its own kind of wrong, and the one a seller has to explain.
 *
 * A no-op for the other sixty-six currencies, where the step is one.
 */
export function toChargeableTotals(
  totals: Totals,
  currency: string,
  /*
   * Required, not optional, and this is the reason: inclusive tax is already
   * inside the prices, so `computeTotals` deliberately leaves it out of the
   * total. A first version of this re-derived the total by adding tax
   * unconditionally, which charged an inclusive-tax shop its own VAT a second
   * time — twenty per cent too much, on the money path, in the five currencies
   * this function exists for. Making the caller state it means the next person
   * cannot forget it the way I did.
   */
  taxInclusive: boolean,
): Totals {
  const step = chargeStep(currency);
  if (step === 1) return totals;

  const round = (n: number) => Math.round(n / step) * step;

  const subtotalCents = round(totals.subtotalCents);
  const discountCents = round(totals.discountCents);
  const deliveryFeeCents = round(totals.deliveryFeeCents);
  const taxCents = round(totals.taxCents);

  return {
    subtotalCents,
    discountCents,
    deliveryFeeCents,
    taxCents,
    /*
     * The same rule `computeTotals` uses, not a second one. Inclusive tax is
     * already inside the subtotal; adding it here charged it twice.
     *
     * Never negative either: a discount rounded up past a subtotal rounded
     * down would otherwise ask the card network for a refund it cannot make.
     */
    totalCents: Math.max(
      0,
      subtotalCents -
        discountCents +
        deliveryFeeCents +
        (taxInclusive ? 0 : taxCents),
    ),
    // Sailo's own cut, which is settled separately and in the platform's own
    // currency, so it is not bound by this currency's settlement step.
    commissionCents: totals.commissionCents,
  };
}
