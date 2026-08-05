import { describe, expect, it } from "vitest";
import {
  ANALYTICS_RANGES,
  atProductLimit,
  can,
  cheapestPlanWith,
  clampAnalyticsRange,
  isPlanId,
  PLAN_IDS,
  PLANS,
  planFor,
  productLimit,
} from "@/lib/plans";

type Billing = Parameters<typeof can>[0];
const shop = (plan: string, status: string | null = "active") =>
  ({ plan, subscriptionStatus: status }) as Billing;

const free = shop("free", null);
const pro = shop("pro");
const business = shop("business");

describe("plan lookup", () => {
  it("knows every id it ships", () => {
    for (const id of PLAN_IDS) expect(isPlanId(id)).toBe(true);
    expect(isPlanId("enterprise")).toBe(false);
  });

  it("falls back to free for an unknown plan", () => {
    expect(planFor(shop("nonsense")).id).toBe("free");
  });

  it("prices Business at $19.99 a month", () => {
    // The pricing table and the Stripe price are checked against each other at
    // checkout; this pins the number the table itself quotes.
    expect(PLANS.business.monthlyCents).toBe(1_999);
    expect(PLANS.pro.monthlyCents).toBe(999);
  });

  it("discounts the yearly price", () => {
    for (const id of PLAN_IDS) {
      if (PLANS[id].monthlyCents === 0) continue;
      expect(PLANS[id].yearlyCents).toBeLessThan(PLANS[id].monthlyCents * 12);
    }
  });
});

describe("entitlements", () => {
  it.each([
    ["coupons", false, false, true],
    ["affiliates", false, false, true],
    ["cardRails", false, false, true],
    ["removeBadge", false, true, true],
    ["csvExport", false, true, true],
  ] as const)("%s: free=%s pro=%s business=%s", (feature, f, p, b) => {
    expect(can(free, feature)).toBe(f);
    expect(can(pro, feature)).toBe(p);
    expect(can(business, feature)).toBe(b);
  });

  it("revokes access when the subscription is cancelled", () => {
    expect(can(shop("business", "canceled"), "coupons")).toBe(false);
  });

  it("keeps access while a payment is being retried", () => {
    // Stripe retries a failed charge for days. Cutting a seller off on the
    // first failure takes their shop down over a card that expired.
    expect(can(shop("business", "past_due"), "coupons")).toBe(true);
  });

  it("points each paid feature at the cheapest plan that has it", () => {
    expect(cheapestPlanWith("coupons")?.id).toBe("business");
    expect(cheapestPlanWith("removeBadge")?.id).toBe("pro");
  });
});

describe("product limits", () => {
  it("caps free at 20", () => {
    expect(productLimit(free)).toBe(20);
    expect(atProductLimit(free, 19)).toBe(false);
    expect(atProductLimit(free, 20)).toBe(true);
    expect(atProductLimit(free, 21)).toBe(true);
  });

  it("caps pro at 250", () => {
    expect(productLimit(pro)).toBe(250);
  });

  it("leaves business uncapped", () => {
    // `null` is the sentinel, not Infinity — `atProductLimit` reads it.
    expect(productLimit(business)).toBeNull();
    expect(atProductLimit(business, 100_000)).toBe(false);
  });
});

describe("analytics range", () => {
  it("clamps free to 30 days", () => {
    expect(clampAnalyticsRange(free, 1_095)).toBe(30);
  });

  it("lets business see the full history", () => {
    expect(clampAnalyticsRange(business, 1_095)).toBe(1_095);
  });

  it.each([[0], [-5], [NaN], [undefined]])("survives a range of %s", (range) => {
    const days = clampAnalyticsRange(business, range as number);
    expect(ANALYTICS_RANGES).toContain(days);
  });

  it("never returns a range outside the offered set", () => {
    expect(ANALYTICS_RANGES).toContain(clampAnalyticsRange(free, 999_999));
  });
});
