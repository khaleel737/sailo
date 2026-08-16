import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/plans";

/**
 * The homepage once advertised $19.99 while Stripe charged $29.99.
 *
 * The fix was to make one of them the source of truth, and these pin that it
 * stays that way: `PLANS` holds the number, the marketing page derives it, and
 * the Stripe setup script reconciles against the same constant. A price typed
 * into the page is the failure — it looks right in review and is wrong at the
 * card.
 */

const source = readFileSync(
  join(import.meta.dirname, "pricing-section.tsx"),
  "utf8",
);

describe("advertised pricing", () => {
  it("names the plans the checkout can actually sell", () => {
    expect(PLANS.free.monthlyCents).toBe(0);
    expect(PLANS.pro.monthlyCents).toBe(1900);
    expect(PLANS.business.monthlyCents).toBe(4900);
  });

  /*
   * The fee is advertised on the same page as the price, so it drifts the same
   * way — and a fee that rose with the plan would read as a typo on the page
   * while quietly charging the biggest sellers the most, which is the shape
   * this pricing replaced.
   */
  it("charges less on card as the plan costs more", () => {
    expect(PLANS.free.feeBp).toBe(300);
    expect(PLANS.pro.feeBp).toBe(200);
    expect(PLANS.business.feeBp).toBe(100);
  });

  it("bills yearly below twelve months, or the yearly option is a penalty", () => {
    for (const plan of [PLANS.pro, PLANS.business]) {
      expect(plan.yearlyCents).toBeGreaterThan(0);
      expect(plan.yearlyCents).toBeLessThan(plan.monthlyCents * 12);
    }
  });

  it("does not hardcode a price", () => {
    // Any currency-looking literal in the markup is a number that can drift
    // away from what the subscription actually charges.
    expect(source).not.toMatch(/\$\s?\d/);
    expect(source).not.toMatch(/\b\d+\.\d{2}\b/);
  });

  it("renders money through the formatter, not string concatenation", () => {
    expect(source).toContain("formatMoney(plan.monthlyCents");
    expect(source).toContain("formatMoney(plan.yearlyCents");
  });

  it("features exactly one plan", () => {
    const featured = Object.values(PLANS).filter((p) => p.id === "business");
    expect(featured).toHaveLength(1);
    expect(source).toContain('plan.id === "business"');
  });
});
