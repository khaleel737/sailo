import { describe, expect, it } from "vitest";
import {
  PLANS,
  PLAN_IDS,
  PLATFORM_FEE_RANGE_LABEL,
  can,
  planFor,
  platformFeeBp,
  platformFeeCents,
  platformFeePercent,
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
  const biz = shop("business", "active");
  const order = (
    subtotalCents: number,
    discountCents = 0,
    tax: { taxRateBp?: number; taxInclusive?: boolean } = {},
  ) => ({
    subtotalCents,
    discountCents,
    taxRateBp: tax.taxRateBp ?? 0,
    taxInclusive: tax.taxInclusive ?? false,
  });

  /**
   * The ladder falls as the plan rises. Asserted as a whole rather than one
   * plan at a time because the ordering is the product decision — a tier that
   * costs more and charges more is the inverted ladder this replaced, and it
   * would pass three separate equality checks without complaint.
   */
  it("falls as the plan rises — 3% free, 2% pro, 1% business", () => {
    expect(platformFeeBp(shop("free", null))).toBe(300);
    expect(platformFeeBp(shop("pro", "active"))).toBe(200);
    expect(platformFeeBp(biz)).toBe(100);

    const bps = PLAN_IDS.map((id) => PLANS[id].feeBp);
    expect(bps).toEqual([...bps].sort((a, b) => b - a));
  });

  it("charges the plan a shop is entitled to, not the column it typed", () => {
    // A cancelled Business shop is a Free shop, and pays Free's rate.
    expect(platformFeeBp(shop("business", "canceled"))).toBe(300);
    // A comped plan outranks Stripe here exactly as it does for features.
    expect(platformFeeBp(shop("free", null, "business"))).toBe(100);
  });

  it("takes one percent of the goods on business", () => {
    expect(platformFeeCents(biz, order(4800))).toBe(48);
    expect(platformFeeLabel(biz)).toBe("1%");
  });

  it("quotes the ladder as a range where no shop is in scope", () => {
    // Marketing and legal copy interpolates this into an existing `{fee}`
    // slot, so it has to read as a noun phrase, not a list.
    expect(PLATFORM_FEE_RANGE_LABEL).toBe("1–3%");
  });

  it("takes the discount off first — a cut of a price nobody paid is not a sale", () => {
    expect(platformFeeCents(biz, order(10_000, 2_000))).toBe(80);
  });

  it("rounds to the nearest cent", () => {
    // 1% of $2.45 is 2.45 cents; of $2.55 it is 2.55.
    expect(platformFeeCents(biz, order(245))).toBe(2);
    expect(platformFeeCents(biz, order(255))).toBe(3);
  });

  it("charges nothing on a free order", () => {
    expect(platformFeeCents(biz, order(0))).toBe(0);
  });

  it("never goes negative when a discount exceeds the subtotal", () => {
    expect(platformFeeCents(biz, order(1_000, 5_000))).toBe(0);
  });

  /*
   * Delivery is money the seller hands to a courier and tax is money they
   * collect for a government. Neither is theirs, so neither is ours.
   *
   * This used to be asserted by noting the function was only given
   * `subtotalCents` and `discountCents`, and concluding it therefore could not
   * charge on tax. That reasoning was wrong, and it is what let the bug below
   * through: under inclusive pricing the tax is *inside* `subtotalCents`, so
   * withholding the tax fields did not withhold the tax.
   */
  it("never charges on delivery, which is not in the subtotal", () => {
    // Delivery genuinely is a separate field the function never receives.
    expect(platformFeeCents(biz, order(5_000))).toBe(50);
  });

  it("charges the full subtotal when tax is added on top", () => {
    // US-style: the $50 is pre-tax and the tax is charged beside it, so the
    // subtotal is already the goods.
    expect(platformFeeCents(biz, order(5_000, 0, { taxRateBp: 2_000 }))).toBe(50);
  });

  it("strips tax that is baked into the price before charging", () => {
    /*
     * The bug. A €100 VAT-inclusive sale at 20% earns the seller €83.33; the
     * remaining €16.67 is the government's. Charging the fee on the full €100
     * billed them for holding it. `pricing.ts` already strips inclusive tax
     * before paying affiliate commission — this did not.
     */
    const fee = platformFeeCents(
      biz,
      order(10_000, 0, { taxRateBp: 2_000, taxInclusive: true }),
    );
    // 1% of the €83.33 that is actually the seller's, not of the €100.
    expect(fee).toBe(83);
    expect(fee).toBeLessThan(100);
  });

  it("takes the discount off before extracting the tax", () => {
    // €100 less a €20 coupon is an €80 inclusive sale: €66.67 of goods.
    expect(
      platformFeeCents(
        biz,
        order(10_000, 2_000, { taxRateBp: 2_000, taxInclusive: true }),
      ),
    ).toBe(67);
  });

  it("charges nothing on an inclusive order that is entirely tax", () => {
    // Degenerate, but it must not go negative.
    expect(
      platformFeeCents(biz, order(100, 0, { taxRateBp: 1_000_000, taxInclusive: true })),
    ).toBe(0);
  });
});

/**
 * The same fee, quoted the way a subscription needs it.
 *
 * A recurring charge cannot name an amount — Stripe raises each invoice and a
 * proration or a coupon changes what it comes to — so the fee goes on as a
 * percentage. The number has to be the *same* number: a membership charged at
 * a different rate from a one-time sale would be a second fee policy nobody
 * decided on, found months later in a payout.
 */
describe("the fee on a subscription", () => {
  const biz = { plan: "business", subscriptionStatus: "active" };

  it("is the one-time rate expressed as a percentage", () => {
    // 100bp on a 4800 sale is 48 — and 1% of 4800 is the same 48.
    expect(platformFeePercent(biz)).toBe(1);
    expect(Math.round((4_800 * platformFeePercent(biz)) / 100)).toBe(
      platformFeeCents(biz, {
        subtotalCents: 4_800,
        discountCents: 0,
        taxRateBp: 0,
        taxInclusive: false,
      }),
    );
  });

  it("is a number Stripe will accept", () => {
    // `application_fee_percent` is a percentage, not basis points: handing it
    // 50 would take half of every invoice.
    const percent = platformFeePercent(biz);
    expect(percent).toBeGreaterThan(0);
    expect(percent).toBeLessThanOrEqual(100);
  });
});
