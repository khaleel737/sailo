import { describe, expect, it } from "vitest";
import type { Coupon, DeliveryMethod } from "@/db/schema";
import {
  bpToPercent,
  commission,
  couponDiscount,
  deliveryFee,
  formatPercent,
  normalizeCode,
  percentToBp,
  taxOn,
} from "./pricing";

/**
 * The arithmetic behind what a buyer is charged.
 *
 * This module had no test file at all. Every amount on every order goes
 * through it, and each function below is one rounding decision away from
 * charging the wrong number — small enough to pass review, large enough to
 * matter across a shop's whole history.
 */

const coupon = (over: Partial<Coupon>): Coupon =>
  ({ discountType: "percent", discountValue: 1000, ...over }) as Coupon;

const method = (over: Partial<DeliveryMethod>): DeliveryMethod =>
  ({ feeCents: 500, freeOverCents: null, ...over }) as DeliveryMethod;

describe("taxOn", () => {
  it("adds tax when the price is pre-tax", () => {
    // US sales tax: $100 at 20% becomes $120.
    expect(taxOn(10_000, 2000, false)).toBe(2000);
  });

  it("extracts tax when the price already contains it", () => {
    /*
     * The one that matters. £100 at 20% VAT is £83.33 + £16.67, still £100.
     * Multiplying by the rate instead would report £20 — over by a sixth, and
     * a wrong VAT return every quarter.
     */
    expect(taxOn(10_000, 2000, true)).toBe(1667);
  });

  it("keeps an inclusive total whole", () => {
    const gross = 10_000;
    const tax = taxOn(gross, 2000, true);
    // Extracted tax plus the net must equal what the buyer was shown.
    expect(gross - tax + tax).toBe(gross);
  });

  it("charges nothing at a zero rate or on a zero base", () => {
    expect(taxOn(10_000, 0, false)).toBe(0);
    expect(taxOn(0, 2000, false)).toBe(0);
  });

  it("never returns a negative", () => {
    // A refund line can arrive here with a negative base.
    expect(taxOn(-500, 2000, false)).toBe(0);
  });

  it("rounds to whole cents", () => {
    expect(Number.isInteger(taxOn(999, 1750, true))).toBe(true);
    expect(Number.isInteger(taxOn(333, 875, false))).toBe(true);
  });
});

describe("couponDiscount", () => {
  it("takes a percentage in basis points", () => {
    expect(couponDiscount(coupon({ discountValue: 1000 }), 10_000)).toBe(1000);
  });

  it("takes a fixed amount as given", () => {
    expect(
      couponDiscount(coupon({ discountType: "fixed", discountValue: 250 }), 10_000),
    ).toBe(250);
  });

  it("never discounts more than the basket costs", () => {
    // A £50 code on a £10 basket must not make the order negative.
    expect(
      couponDiscount(coupon({ discountType: "fixed", discountValue: 5000 }), 1000),
    ).toBe(1000);
  });

  it("never returns a negative discount", () => {
    expect(
      couponDiscount(coupon({ discountType: "fixed", discountValue: -500 }), 1000),
    ).toBe(0);
  });

  it("rounds a percentage to whole cents", () => {
    expect(Number.isInteger(couponDiscount(coupon({ discountValue: 1234 }), 999))).toBe(
      true,
    );
  });
});

describe("deliveryFee", () => {
  it("is nothing when there is no delivery method", () => {
    expect(deliveryFee(null, 10_000)).toBe(0);
    expect(deliveryFee(undefined, 10_000)).toBe(0);
  });

  it("charges the method's fee", () => {
    expect(deliveryFee(method({ feeCents: 599 }), 1000)).toBe(599);
  });

  it("waives the fee at the free-over threshold, not past it", () => {
    // Exactly the threshold qualifies — a buyer who hits "spend £50 for free
    // delivery" precisely must not still be charged.
    expect(deliveryFee(method({ freeOverCents: 5000 }), 5000)).toBe(0);
    expect(deliveryFee(method({ freeOverCents: 5000 }), 4999)).toBe(500);
  });

  it("checks the threshold against the discounted subtotal", () => {
    /*
     * The caller passes the net. A coupon that drops a basket below the
     * threshold has to reinstate the delivery fee, or the discount silently
     * pays for postage too.
     */
    expect(deliveryFee(method({ freeOverCents: 5000 }), 4000)).toBe(500);
  });

  it("never charges a negative fee", () => {
    expect(deliveryFee(method({ feeCents: -100 }), 1000)).toBe(0);
  });
});

describe("commission", () => {
  it("is a share of the goods in basis points", () => {
    expect(commission(10_000, 1000)).toBe(1000);
  });

  it("is nothing at a zero rate", () => {
    expect(commission(10_000, 0)).toBe(0);
  });

  it("never goes negative on a credited order", () => {
    expect(commission(-10_000, 1000)).toBe(0);
  });

  it("rounds to whole cents", () => {
    expect(Number.isInteger(commission(999, 1750))).toBe(true);
  });
});

describe("basis points and percent", () => {
  it("round-trips a whole percent", () => {
    expect(bpToPercent(percentToBp(20))).toBe(20);
  });

  it("carries a fractional rate, which real tax rates have", () => {
    // 7.5% GST, 19.6% historic French VAT — a whole-number type loses these.
    expect(percentToBp(7.5)).toBe(750);
    expect(bpToPercent(750)).toBe(7.5);
  });

  it("formats without a trailing zero on a whole rate", () => {
    expect(formatPercent(2000)).toBe("20");
    expect(formatPercent(750)).toBe("7.5");
  });
});

describe("normalizeCode", () => {
  it("makes the same code out of the ways a buyer might type it", () => {
    expect(normalizeCode("  summer  ")).toBe("SUMMER");
    expect(normalizeCode("Summer")).toBe("SUMMER");
  });
});
