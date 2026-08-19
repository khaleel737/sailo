import { describe, expect, it } from "vitest";
import { quote } from "../money/quote";
import type { Coupon } from "@sailo/db/schema";
import {
  clampPwywCents,
  effectiveSellWindow,
  hiddenOutsideWindow,
  isPricingMode,
  normalizePricingMode,
  pwywAllowedForKind,
  pwywFloorCents,
  pwywSuggestedCents,
  resolvedUnitPriceCents,
  sellWindowState,
  showsCompareAt,
  type PricedByBuyer,
} from "./pricing-models";

/**
 * Pay-what-you-want is the only place in the checkout where a price comes from
 * the request, so this file is mostly a list of the things a request can
 * contain. Every case below is reachable by hand and none of them by using the
 * shop, which is exactly the population a clamp exists for.
 */

function product(over: Partial<PricedByBuyer> = {}): PricedByBuyer {
  return {
    priceCents: 2000,
    compareAtCents: null,
    pricingMode: "pwyw",
    minPriceCents: 500,
    suggestedPriceCents: 1000,
    ...over,
  };
}

describe("the floor", () => {
  it("takes what the buyer typed when it clears the floor", () => {
    expect(clampPwywCents(product(), null, 1500)).toBe(1500);
  });

  it("lifts anything under the floor to it", () => {
    expect(clampPwywCents(product(), null, 499)).toBe(500);
    expect(clampPwywCents(product(), null, 0)).toBe(500);
  });

  it("reads a negative as the floor rather than a discount", () => {
    // A negative line would subtract from the basket's subtotal, which is a
    // discount the buyer wrote themselves.
    expect(clampPwywCents(product(), null, -5000)).toBe(500);
  });

  it("refuses NaN and Infinity, which are what a forged body carries", () => {
    // `Math.trunc(Infinity)` is `Infinity`, and it would reach `computeTotals`
    // as a total no currency can settle.
    expect(clampPwywCents(product(), null, Number.NaN)).toBe(1000);
    expect(clampPwywCents(product(), null, Number.POSITIVE_INFINITY)).toBe(1000);
    expect(clampPwywCents(product(), null, Number.NEGATIVE_INFINITY)).toBe(1000);
  });

  it("refuses a string, however numeric it looks", () => {
    // JSON carries strings happily. `"2500"` is not minor units, it is a value
    // that would concatenate rather than add three functions downstream.
    expect(clampPwywCents(product(), null, "2500")).toBe(1000);
    expect(clampPwywCents(product(), null, "")).toBe(1000);
    expect(clampPwywCents(product(), null, null)).toBe(1000);
    expect(clampPwywCents(product(), null, undefined)).toBe(1000);
  });

  it("truncates a fraction of a minor unit", () => {
    // A minor unit is the smallest thing money comes in. 12.5 cents is not an
    // amount, and rounding it up would charge more than was typed.
    expect(clampPwywCents(product(), null, 1500.9)).toBe(1500);
  });

  it("does not cap the top — paying more is the whole point", () => {
    expect(clampPwywCents(product(), null, 999_999)).toBe(999_999);
  });
});

describe("blank versus zero on the floor", () => {
  it("reads null as the list price, not as free", () => {
    // Null is "not configured". A product switched to PWYW before the seller
    // has typed a floor must not become free the moment the mode changes.
    const p = product({ minPriceCents: null });
    expect(pwywFloorCents(p, null)).toBe(2000);
    expect(clampPwywCents(p, null, 100)).toBe(2000);
  });

  it("reads zero as free-is-allowed, which is the whole of a donation", () => {
    const p = product({ minPriceCents: 0, suggestedPriceCents: 500 });
    expect(pwywFloorCents(p, null)).toBe(0);
    expect(clampPwywCents(p, null, 0)).toBe(0);
  });

  it("floors on the variant's own price, not the product's", () => {
    // A variant that sets its own price sets its own floor with it, or the
    // medium would be floored at the small's price.
    const p = product({ minPriceCents: null });
    expect(pwywFloorCents(p, { priceCents: 3500 })).toBe(3500);
  });
});

describe("the suggested amount", () => {
  it("never opens below the floor", () => {
    // A suggestion the server would refuse is a field that fails on submit for
    // a buyer who changed nothing.
    const p = product({ minPriceCents: 1500, suggestedPriceCents: 500 });
    expect(pwywSuggestedCents(p, null)).toBe(1500);
  });

  it("falls back to the list price when unset", () => {
    expect(pwywSuggestedCents(product({ suggestedPriceCents: null }), null)).toBe(2000);
  });
});

describe("a fixed-price product ignores the request entirely", () => {
  it("prices from the row however hard the body pushes", () => {
    const fixed = product({ pricingMode: "fixed" });
    expect(resolvedUnitPriceCents(fixed, null, 1)).toBe(2000);
    expect(resolvedUnitPriceCents(fixed, null, 999_999)).toBe(2000);
  });

  it("still prefers the variant's price where there is one", () => {
    const fixed = product({ pricingMode: "fixed" });
    expect(resolvedUnitPriceCents(fixed, { priceCents: 2600 }, 1)).toBe(2600);
  });

  it("keeps the strike-through, which a buyer-chosen amount does not get", () => {
    expect(showsCompareAt(product({ pricingMode: "fixed" }))).toBe(true);
    expect(showsCompareAt(product())).toBe(false);
  });
});

describe("three-decimal currencies", () => {
  it("clamps in minor units, leaving the charge step to the caller", () => {
    /*
     * KWD is quoted to three places and settled to two, so `resolveLines`
     * rounds this result to the nearest ten fils on the way out. What is pinned
     * here is that the clamp itself does not pre-round — the floor is the
     * seller's number in the currency's own minor units, and rounding before
     * comparing would refuse an amount that clears the floor by a single fils.
     */
    const p = product({ minPriceCents: 12_345, suggestedPriceCents: 20_000 });
    expect(clampPwywCents(p, null, 12_346)).toBe(12_346);
    expect(clampPwywCents(p, null, 12_344)).toBe(12_345);
  });
});

describe("what the mode may be", () => {
  it("takes only the two it knows", () => {
    expect(isPricingMode("pwyw")).toBe(true);
    expect(isPricingMode("fixed")).toBe(true);
    expect(isPricingMode("donation")).toBe(false);
    expect(isPricingMode(null)).toBe(false);
  });

  it("falls back to fixed rather than to free", () => {
    // A product whose mode is a typo must go on selling at its list price.
    expect(normalizePricingMode("pywy", "digital")).toBe("fixed");
    expect(normalizePricingMode(undefined, "digital")).toBe("fixed");
  });

  it("refuses pay-what-you-want on a membership", () => {
    // A recurring buyer-chosen amount is a Stripe Price per buyer.
    expect(pwywAllowedForKind("membership")).toBe(false);
    expect(normalizePricingMode("pwyw", "membership")).toBe("fixed");
    expect(normalizePricingMode("pwyw", "digital")).toBe("pwyw");
  });
});

/* -------------------------------------------------------------------------- */
/*  Sell windows                                                               */
/* -------------------------------------------------------------------------- */

const MARCH = new Date("2026-03-01T12:00:00Z");
const JUNE = new Date("2026-06-01T12:00:00Z");
const DECEMBER = new Date("2026-12-01T12:00:00Z");

describe("sell windows", () => {
  const window = { sellFrom: new Date("2026-05-01T00:00:00Z"), sellUntil: new Date("2026-09-01T00:00:00Z") };

  it("is open inside, early before and ended after", () => {
    expect(sellWindowState(window, null, JUNE)).toBe("open");
    expect(sellWindowState(window, null, MARCH)).toBe("early");
    expect(sellWindowState(window, null, DECEMBER)).toBe("ended");
  });

  it("opens on the second it starts and closes on the second it ends", () => {
    // The seller picked the times; a buyer arriving on the boundary is served
    // by the reading that surprises neither of them.
    expect(sellWindowState(window, null, window.sellFrom)).toBe("open");
    expect(sellWindowState(window, null, window.sellUntil)).toBe("ended");
  });

  it("is open all the time when neither bound is set", () => {
    const none = { sellFrom: null, sellUntil: null };
    expect(sellWindowState(none, null, MARCH)).toBe("open");
    expect(sellWindowState(none, null, DECEMBER)).toBe("open");
  });

  it("takes one bound without the other", () => {
    expect(sellWindowState({ sellFrom: null, sellUntil: window.sellUntil }, null, MARCH)).toBe("open");
    expect(sellWindowState({ sellFrom: window.sellFrom, sellUntil: null }, null, DECEMBER)).toBe("open");
  });
});

describe("a variant's window narrows and never widens", () => {
  const product = {
    sellFrom: new Date("2026-05-01T00:00:00Z"),
    sellUntil: new Date("2026-09-01T00:00:00Z"),
  };

  it("takes the later start", () => {
    // An early-bird tier cannot open before the product it belongs to.
    const early = { sellFrom: new Date("2026-01-01T00:00:00Z"), sellUntil: null };
    expect(effectiveSellWindow(product, early).sellFrom).toEqual(product.sellFrom);
    expect(sellWindowState(product, early, MARCH)).toBe("early");
  });

  it("takes the earlier end", () => {
    // And an early-bird tier that closes on the 1st of June closes then, even
    // though the product keeps selling until September.
    const expires = { sellFrom: null, sellUntil: new Date("2026-06-01T00:00:00Z") };
    expect(sellWindowState(product, expires, new Date("2026-06-02T00:00:00Z"))).toBe("ended");
    // …while the product itself is still open, which is the case the columns
    // exist for.
    expect(sellWindowState(product, null, new Date("2026-06-02T00:00:00Z"))).toBe("open");
  });

  it("cannot extend past the product's own end", () => {
    const longer = { sellFrom: null, sellUntil: new Date("2027-01-01T00:00:00Z") };
    expect(effectiveSellWindow(product, longer).sellUntil).toEqual(product.sellUntil);
    expect(sellWindowState(product, longer, DECEMBER)).toBe("ended");
  });

  it("stands on its own where the product has no window", () => {
    const unbounded = { sellFrom: null, sellUntil: null };
    const tier = { sellFrom: new Date("2026-05-01T00:00:00Z"), sellUntil: null };
    expect(sellWindowState(unbounded, tier, MARCH)).toBe("early");
    expect(sellWindowState(unbounded, tier, JUNE)).toBe("open");
  });
});

describe("hiding versus showing as closed", () => {
  const closed = { sellFrom: null, sellUntil: new Date("2026-05-01T00:00:00Z") };

  it("hides only when the seller asked", () => {
    expect(hiddenOutsideWindow({ ...closed, hideWhenUnavailable: true }, null, JUNE)).toBe(true);
    expect(hiddenOutsideWindow({ ...closed, hideWhenUnavailable: false }, null, JUNE)).toBe(false);
  });

  it("never hides a product that is on sale", () => {
    expect(hiddenOutsideWindow({ ...closed, hideWhenUnavailable: true }, null, MARCH)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*  Coupons against an amount the buyer chose                                  */
/* -------------------------------------------------------------------------- */

/**
 * The rule, stated once because both readings are defensible and the code has
 * to pick: **`minPriceCents` is a floor on the *entered* amount, not on the
 * amount after discount.** Flooring the discounted total instead would refuse a
 * legitimate coupon on a legitimate purchase — the buyer cleared the floor, and
 * the seller is the one who issued the code.
 */
function coupon(over: Partial<Coupon>): Coupon {
  return {
    discountType: "percent",
    discountValue: 1000,
    minSubtotalCents: 0,
    startsAt: null,
    expiresAt: null,
    maxRedemptions: null,
    timesRedeemed: 0,
    isActive: true,
    ...over,
  } as Coupon;
}

function pwywLine(cents: number) {
  return {
    productId: "p1",
    variantId: null,
    title: "Name your price",
    kind: "digital",
    options: [],
    variantOptions: null,
    sku: null,
    imageUrl: null,
    unitPriceCents: cents,
    quantity: 1,
  };
}

describe("coupons on a buyer-chosen amount", () => {
  const chosen = clampPwywCents(product(), null, 2500);

  it("takes a percentage off what they actually chose", () => {
    const priced = quote({ lines: [pwywLine(chosen)], coupon: coupon({}) });
    expect(priced.totals.subtotalCents).toBe(2500);
    expect(priced.totals.discountCents).toBe(250);
    expect(priced.totals.totalCents).toBe(2250);
  });

  it("clamps a fixed coupon that exceeds the amount to zero, never below", () => {
    // A buyer who names £5 and holds a £20 code pays nothing. What must not
    // happen is a negative total, which is money owed the wrong way.
    const priced = quote({
      lines: [pwywLine(500)],
      coupon: coupon({ discountType: "fixed", discountValue: 2000 }),
    });
    expect(priced.totals.discountCents).toBe(500);
    expect(priced.totals.totalCents).toBe(0);
  });

  it("does not re-floor after the discount", () => {
    /*
     * The entered amount cleared the seller's 500 floor; the code then takes it
     * to 250. That is the seller's own discount doing what they configured, and
     * refusing it would be the checkout second-guessing a coupon the shop
     * issued.
     */
    const priced = quote({
      lines: [pwywLine(clampPwywCents(product(), null, 500))],
      coupon: coupon({ discountValue: 5000 }),
    });
    expect(priced.totals.totalCents).toBe(250);
  });
});
