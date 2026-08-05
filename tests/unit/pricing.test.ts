import { describe, expect, it } from "vitest";
import {
  bpToPercent,
  checkCoupon,
  commission,
  computeTotals,
  couponDiscount,
  deliveryFee,
  formatPercent,
  generateCode,
  normalizeCode,
  percentToBp,
  taxOn,
} from "@/lib/pricing";
import type { Coupon } from "@/db/schema";

const NOW = new Date("2026-06-01T12:00:00Z");

function coupon(over: Partial<Coupon> = {}): Coupon {
  return {
    id: "c1",
    shopId: "s1",
    code: "SAVE",
    discountType: "percent",
    discountValue: 1_000,
    minSubtotalCents: 0,
    maxRedemptions: null,
    timesRedeemed: 0,
    startsAt: null,
    expiresAt: null,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Coupon;
}

describe("basis points", () => {
  it("round-trips a whole percent", () => {
    expect(percentToBp(20)).toBe(2_000);
    expect(bpToPercent(2_000)).toBe(20);
  });

  it("keeps a fractional rate exact", () => {
    expect(percentToBp(7.5)).toBe(750);
    expect(formatPercent(750)).toBe("7.5");
  });

  it("drops the trailing zero on a whole percent", () => {
    expect(formatPercent(2_000)).toBe("20");
  });
});

describe("tax", () => {
  it("adds the rate when prices exclude tax", () => {
    expect(taxOn(10_000, 2_000, false)).toBe(2_000);
  });

  it("extracts the rate when prices already include it", () => {
    // £100 at 20% is £83.33 + £16.67 — not £100 + £20. Multiplying here
    // over-reports by a sixth and produces a wrong VAT return.
    expect(taxOn(10_000, 2_000, true)).toBe(1_667);
  });

  it("never extracts more than the base", () => {
    expect(taxOn(100, 10_000, true)).toBeLessThan(100);
  });

  it.each([
    [0, 2_000, false, 0],
    [-500, 2_000, false, 0],
    [10_000, 0, false, 0],
  ])("is zero for base %i at %i bp", (base, rate, inclusive, expected) => {
    expect(taxOn(base, rate, inclusive)).toBe(expected);
  });

  it("rounds to the nearest cent", () => {
    expect(taxOn(999, 725, false)).toBe(72);
  });
});

describe("coupons", () => {
  it("takes a percentage", () => {
    expect(couponDiscount(coupon(), 10_000)).toBe(1_000);
  });

  it("takes a fixed amount", () => {
    expect(
      couponDiscount(coupon({ discountType: "fixed", discountValue: 2_500 }), 10_000),
    ).toBe(2_500);
  });

  it("never discounts more than the subtotal", () => {
    expect(
      couponDiscount(coupon({ discountType: "fixed", discountValue: 2_500 }), 1_000),
    ).toBe(1_000);
  });

  it.each([
    ["missing", null, "not_found"],
    ["inactive", coupon({ isActive: false }), "inactive"],
    ["expired", coupon({ expiresAt: new Date("2026-01-01") }), "expired"],
    ["not started", coupon({ startsAt: new Date("2026-12-01") }), "not_started"],
    ["used up", coupon({ maxRedemptions: 1, timesRedeemed: 1 }), "used_up"],
    ["below minimum", coupon({ minSubtotalCents: 20_000 }), "below_minimum"],
  ])("rejects a %s coupon", (_label, given, reason) => {
    const verdict = checkCoupon(given, 10_000, NOW);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe(reason);
  });

  it("accepts one that is live", () => {
    const verdict = checkCoupon(coupon(), 10_000, NOW);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.discountCents).toBe(1_000);
  });

  it("treats the expiry as exclusive", () => {
    const atExpiry = checkCoupon(coupon({ expiresAt: NOW }), 10_000, NOW);
    expect(atExpiry.ok).toBe(false);
  });

  it("normalises a typed code", () => {
    expect(normalizeCode(" save-10 ")).toBe("SAVE-10");
    expect(normalizeCode("a b€c")).toBe("ABC");
  });

  it("generates a code with no punctuation to mistype", () => {
    expect(generateCode("Amina Yusuf")).toMatch(/^[A-Z0-9_-]+$/);
  });
});

describe("delivery", () => {
  it("charges the fee below the free-over threshold", () => {
    expect(deliveryFee({ feeCents: 500, freeOverCents: 5_000 }, 4_000)).toBe(500);
  });

  it("is free at the threshold", () => {
    expect(deliveryFee({ feeCents: 500, freeOverCents: 5_000 }, 5_000)).toBe(0);
  });

  it("is free with no method", () => {
    expect(deliveryFee(null, 4_000)).toBe(0);
  });

  it("never goes negative", () => {
    expect(deliveryFee({ feeCents: -100, freeOverCents: null }, 0)).toBe(0);
  });
});

describe("commission", () => {
  it("is a share of the net", () => {
    expect(commission(10_000, 1_500)).toBe(1_500);
  });

  it("is never negative", () => {
    expect(commission(-100, 1_500)).toBe(0);
  });
});

describe("computeTotals", () => {
  const shipping = { feeCents: 500, freeOverCents: 10_000 };
  const vat = {
    taxEnabled: true,
    taxName: "VAT",
    taxRateBp: 2_000,
    taxInclusive: false,
    taxOnDelivery: true,
  };

  it("sums goods, delivery and tax", () => {
    const t = computeTotals({
      subtotalCents: 10_000,
      deliveryMethod: { feeCents: 500, freeOverCents: null },
      tax: vat,
      now: NOW,
    });
    expect(t.subtotalCents).toBe(10_000);
    expect(t.deliveryFeeCents).toBe(500);
    expect(t.taxCents).toBe(2_100);
    expect(t.totalCents).toBe(12_600);
  });

  it("checks the free-shipping threshold after the discount", () => {
    // A coupon can take an order back under the free-shipping line. Charging
    // free shipping on a subtotal the buyer no longer reaches loses money.
    const t = computeTotals({
      subtotalCents: 10_000,
      coupon: coupon(),
      deliveryMethod: shipping,
      now: NOW,
    });
    expect(t.discountCents).toBe(1_000);
    expect(t.deliveryFeeCents).toBe(500);
  });

  it("taxes the discounted amount, not the list price", () => {
    const t = computeTotals({
      subtotalCents: 10_000,
      coupon: coupon(),
      deliveryMethod: { feeCents: 500, freeOverCents: null },
      tax: vat,
      now: NOW,
    });
    expect(t.taxCents).toBe(1_900);
    expect(t.totalCents).toBe(9_000 + 500 + 1_900);
  });

  it("leaves the total alone when tax is included in prices", () => {
    const t = computeTotals({
      subtotalCents: 10_000,
      deliveryMethod: { feeCents: 500, freeOverCents: null },
      tax: { ...vat, taxInclusive: true },
      now: NOW,
    });
    expect(t.totalCents).toBe(10_500);
    expect(t.taxCents).toBe(1_750);
  });

  it("excludes exempt delivery from the taxable base", () => {
    const t = computeTotals({
      subtotalCents: 10_000,
      deliveryMethod: { feeCents: 500, freeOverCents: null },
      tax: { ...vat, taxOnDelivery: false },
      now: NOW,
    });
    expect(t.taxCents).toBe(2_000);
    expect(t.totalCents).toBe(12_500);
  });

  it("charges no tax when the shop isn't registered", () => {
    const t = computeTotals({
      subtotalCents: 10_000,
      tax: { ...vat, taxEnabled: false },
      now: NOW,
    });
    expect(t.taxCents).toBe(0);
    expect(t.totalCents).toBe(10_000);
  });

  it("pays commission on goods, never on tax", () => {
    const t = computeTotals({
      subtotalCents: 10_000,
      deliveryMethod: { feeCents: 500, freeOverCents: null },
      commissionBp: 1_000,
      tax: vat,
      now: NOW,
    });
    expect(t.commissionCents).toBe(1_000);
  });

  it("strips tax out of the commission base when prices include it", () => {
    // Goods are 10,000 inclusive of 1,667 VAT, so the affiliate earns 10% of
    // 8,333 — not of the buyer's full 10,000.
    const t = computeTotals({
      subtotalCents: 10_000,
      commissionBp: 1_000,
      tax: { ...vat, taxInclusive: true },
      now: NOW,
    });
    expect(t.commissionCents).toBe(833);
  });

  it("never produces a negative total", () => {
    const t = computeTotals({
      subtotalCents: 1_000,
      coupon: coupon({ discountType: "fixed", discountValue: 999_999 }),
      now: NOW,
    });
    expect(t.totalCents).toBeGreaterThanOrEqual(0);
  });
});
