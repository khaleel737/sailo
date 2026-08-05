import { describe, expect, it } from "vitest";
import {
  PLANS,
  can,
  planFor,
  platformFeeBp,
  platformFeeCents,
  platformFeeLabel,
} from "./plans";

/**
 * The badge is the free tier's rent: a free shop carries "Powered by Sailo",
 * a paid one doesn't. That makes `removeBadge` an entitlement, so it has to
 * survive the ways a paid shop stops being paid — a cancelled subscription,
 * a missing status, a hand-edited plan column.
 */

/** The two billing columns `planFor` actually reads, plus the /hq override. */
function shop(plan: string, subscriptionStatus: string | null, compPlan?: string | null) {
  return { plan, subscriptionStatus, compPlan };
}

describe("removeBadge entitlement", () => {
  it("free carries the badge, paid plans do not", () => {
    expect(PLANS.free.features.removeBadge).toBe(false);
    expect(PLANS.pro.features.removeBadge).toBe(true);
    expect(PLANS.business.features.removeBadge).toBe(true);
  });

  it("an active paid subscription removes the badge", () => {
    expect(can(shop("pro", "active"), "removeBadge")).toBe(true);
    expect(can(shop("business", "active"), "removeBadge")).toBe(true);
    expect(can(shop("pro", "trialing"), "removeBadge")).toBe(true);
  });

  it("keeps the badge off through a failed renewal", () => {
    // past_due is entitled on purpose — Stripe retries for days, and a seller
    // mid-sale shouldn't sprout our badge because a card expired.
    expect(can(shop("pro", "past_due"), "removeBadge")).toBe(true);
  });

  it("brings the badge back once the subscription really ends", () => {
    expect(can(shop("pro", "canceled"), "removeBadge")).toBe(false);
    expect(can(shop("pro", "unpaid"), "removeBadge")).toBe(false);
    expect(can(shop("pro", "incomplete_expired"), "removeBadge")).toBe(false);
  });

  it("brings the badge back when the status column is empty", () => {
    // A `pro` row with no status is not a paying shop; it must not read as one.
    expect(can(shop("pro", null), "removeBadge")).toBe(false);
  });

  it("keeps the badge on an unrecognised plan value", () => {
    expect(can(shop("enterprise", "active"), "removeBadge")).toBe(false);
    expect(can(shop("", "active"), "removeBadge")).toBe(false);
  });

  it("honours a comp plan granted from /hq regardless of Stripe", () => {
    // The billing sync rewrites plan+status from Stripe on every billing-page
    // visit, so a comp has to outrank both or it would erase itself.
    expect(can(shop("free", null, "pro"), "removeBadge")).toBe(true);
    expect(can(shop("pro", "canceled", "free"), "removeBadge")).toBe(false);
    expect(planFor(shop("free", null, "pro")).id).toBe("pro");
  });

  it("ignores a junk comp plan rather than trusting it", () => {
    expect(can(shop("free", null, "platinum"), "removeBadge")).toBe(false);
  });
});

/**
 * The platform fee is the only line in this codebase that moves money from a
 * seller to us, so what it is charged *on* matters as much as the rate.
 */
describe("the platform fee on a card sale", () => {
  const free = shop("free", null);
  const order = (subtotalCents: number, discountCents = 0) => ({
    subtotalCents,
    discountCents,
  });

  it("takes one percent of the goods", () => {
    expect(platformFeeBp(free)).toBe(100);
    expect(platformFeeCents(free, order(4800))).toBe(48);
    expect(platformFeeLabel(free)).toBe("1%");
  });

  it("takes the discount off first — 1% of a price nobody paid is not a sale", () => {
    expect(platformFeeCents(free, order(10_000, 2_000))).toBe(80);
  });

  it("rounds to the nearest cent", () => {
    // 1% of $2.45 is 2.45 cents.
    expect(platformFeeCents(free, order(245))).toBe(2);
    expect(platformFeeCents(free, order(255))).toBe(3);
  });

  it("charges nothing on a free order", () => {
    expect(platformFeeCents(free, order(0))).toBe(0);
  });

  it("never goes negative when a discount exceeds the subtotal", () => {
    expect(platformFeeCents(free, order(1_000, 5_000))).toBe(0);
  });

  /*
   * Delivery is money the seller hands to a courier and tax is money they
   * collect for a government. Neither is theirs, so neither is ours. The
   * function only ever sees the two fields it may charge on, which is the
   * cheapest way to keep that true.
   */
  it("is computed from the goods alone", () => {
    const goodsOnly = platformFeeCents(free, order(5_000));
    expect(goodsOnly).toBe(50);
    // An order with $20 delivery and $10 tax on the same goods pays the same.
    expect(platformFeeCents(free, order(5_000, 0))).toBe(goodsOnly);
  });
});
