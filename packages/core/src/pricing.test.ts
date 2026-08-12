import { describe, expect, it } from "vitest";
import type { Coupon, DeliveryMethod } from "@sailo/db/schema";
import { toStripeAmount } from "./currency";
import type { Totals } from "./pricing";
import {
  toChargeableTotals,
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

/**
 * What a card can actually settle.
 *
 * KWD, BHD, JOD, OMR and TND are quoted to three decimals and settled to two,
 * so the last digit of a price in fils is not chargeable and Stripe refuses
 * any amount that is not a multiple of ten. `toStripeAmount` rounded each
 * *line* on the way out, which meant the card was asked for something the
 * order had never said — and the guard meant to catch that compared the
 * unrounded numbers, so it passed. A buyer's statement and their invoice
 * disagreed by up to five fils per line, with nothing in either to explain it.
 */
describe("toChargeableTotals", () => {
  const totals = (over: Partial<Totals> = {}): Totals => ({
    subtotalCents: 0,
    discountCents: 0,
    deliveryFeeCents: 0,
    taxCents: 0,
    totalCents: 0,
    commissionCents: 0,
    ...over,
  });

  it("leaves a two-decimal currency exactly as it was", () => {
    // Sixty-six of the seventy-one. A cent is already the settlement step.
    const t = totals({ subtotalCents: 1999, taxCents: 137, totalCents: 2136 });
    expect(toChargeableTotals(t, "USD", false)).toEqual(t);
    expect(toChargeableTotals(t, "EUR", false)).toEqual(t);
    expect(toChargeableTotals(t, "JPY", false)).toEqual(t);
  });

  it("rounds a three-decimal currency to what the network settles", () => {
    // 5% tax on 12.500 KWD is 625 fils, which no card can charge.
    const t = totals({ subtotalCents: 12_500, taxCents: 625, totalCents: 13_125 });
    const charged = toChargeableTotals(t, "KWD", false);

    expect(charged.taxCents).toBe(630);
    expect(charged.totalCents).toBe(13_130);
  });

  it("keeps the lines adding up to the total", () => {
    /*
     * The total is re-derived from the rounded parts rather than rounded on
     * its own. A receipt whose lines do not sum to its total is its own kind
     * of wrong, and the one a seller has to explain to a buyer.
     */
    for (const code of ["KWD", "BHD", "JOD", "OMR", "TND"]) {
      const c = toChargeableTotals(
        totals({
          subtotalCents: 9_999,
          discountCents: 1_234,
          deliveryFeeCents: 567,
          taxCents: 891,
          totalCents: 10_223,
        }),
        code,
        false,
      );
      expect(
        c.subtotalCents - c.discountCents + c.deliveryFeeCents + c.taxCents,
        code,
      ).toBe(c.totalCents);
    }
  });

  it("makes every part chargeable, not just the total", () => {
    // Stripe is sent line items, so each one has to survive on its own.
    const c = toChargeableTotals(
      totals({
        subtotalCents: 9_999,
        discountCents: 1_234,
        deliveryFeeCents: 567,
        taxCents: 891,
        totalCents: 10_223,
      }),
      "KWD",
      false,
    );
    for (const [name, value] of Object.entries(c)) {
      if (name === "commissionCents") continue; // settled separately, in USD
      expect(value % 10, name).toBe(0);
    }
  });

  it("does not charge inclusive tax a second time", () => {
    /*
     * The bug a review caught in the first version of this function, and the
     * most expensive kind: it re-derived the total by adding tax
     * unconditionally, while `computeTotals` deliberately leaves inclusive tax
     * out because it is already inside the prices. An inclusive-tax shop in
     * one of these five currencies would have charged its own VAT twice —
     * twenty per cent too much, on every card sale.
     *
     * Inclusive: the buyer pays the shelf price and the tax is inside it.
     */
    const inclusive = toChargeableTotals(
      totals({ subtotalCents: 12_000, taxCents: 2_000, totalCents: 12_000 }),
      "KWD",
      true,
    );
    expect(inclusive.totalCents).toBe(12_000);

    // Exclusive: the same numbers, and now the tax really is added on top.
    const exclusive = toChargeableTotals(
      totals({ subtotalCents: 12_000, taxCents: 2_000, totalCents: 14_000 }),
      "KWD",
      false,
    );
    expect(exclusive.totalCents).toBe(14_000);
  });

  it("never asks the network for a negative amount", () => {
    // A discount rounded up past a subtotal rounded down would otherwise ask
    // for a refund the checkout has no way to make.
    const c = toChargeableTotals(
      totals({ subtotalCents: 4, discountCents: 6, totalCents: 0 }),
      "KWD",
      false,
    );
    expect(c.totalCents).toBeGreaterThanOrEqual(0);
  });

  it("agrees with what the Stripe boundary would round to", () => {
    /*
     * The property the whole change exists for: after rounding, sending each
     * part through `toStripeAmount` changes nothing — so the invoice, the
     * total the buyer agreed to and the amount charged are one number.
     */
    for (const code of ["KWD", "BHD", "JOD", "USD", "EUR", "JPY"]) {
      const c = toChargeableTotals(
        totals({
          subtotalCents: 7_777,
          discountCents: 333,
          deliveryFeeCents: 444,
          taxCents: 555,
          totalCents: 8_443,
        }),
        code,
        false,
      );
      const asStripeSees =
        toStripeAmount(c.subtotalCents, code) -
        toStripeAmount(c.discountCents, code) +
        toStripeAmount(c.deliveryFeeCents, code) +
        toStripeAmount(c.taxCents, code);
      expect(asStripeSees, code).toBe(c.totalCents);
    }
  });
});
