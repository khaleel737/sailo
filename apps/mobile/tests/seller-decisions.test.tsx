import { couponState } from "../app/(tabs)/store/coupons";
import { railTone } from "../app/(tabs)/store/payments/index";
import { formatConversion } from "../app/(tabs)/insights/products";
import type { Rail } from "../lib/models";

/**
 * The judgements the seller screens make, pinned away from their layouts.
 *
 * WHY THESE THREE
 *
 * Each one is a place where two states look the same in the data and mean
 * opposite things to a seller. None of them is visible in a screenshot, none
 * of them fails a typecheck, and each has a wrong answer that reads as
 * perfectly reasonable until somebody acts on it:
 *
 *   - a coupon that stopped working, where *why* decides what to do next;
 *   - a payment rail that cannot work here, versus one nobody has filled in;
 *   - a product nobody looked at, versus one people looked at and refused.
 *
 * WHY THEY ARE IMPORTED FROM ROUTE FILES
 *
 * Expo Router only cares about a module's default export, so a named one is
 * free — `store/index.tsx` has exported `PublishBadge` and `useStoreCopy` on
 * the same reasoning since it was written. Moving these into a shared module
 * to make them testable would put three unrelated predicates in one grab-bag
 * for the sake of an import path.
 */

describe("couponState", () => {
  const base = {
    id: "c1",
    code: "SUMMER",
    discountType: "percent",
    discountValue: 1000,
    minSubtotalCents: 0,
    maxRedemptions: null as number | null,
    timesRedeemed: 0,
    expiresAt: null as string | null,
    isActive: true,
  };

  it("is live when nothing has stopped it", () => {
    expect(couponState(base)).toBe("live");
  });

  it("tells a spent coupon apart from a switched-off one", () => {
    /*
     * Both render as "not working" and neither is fixed the same way: a spent
     * coupon needs its cap raised, a switched-off one needs a tap. A single
     * "inactive" state would send a seller to the wrong control.
     */
    expect(couponState({ ...base, maxRedemptions: 50, timesRedeemed: 50 })).toBe("usedUp");
    expect(couponState({ ...base, isActive: false })).toBe("off");
  });

  it("counts a cap as reached when redemptions have overshot it", () => {
    // Redemptions are claimed in SQL and can land together; `>=` rather than
    // `===` is what stops a race reading as still-available.
    expect(couponState({ ...base, maxRedemptions: 5, timesRedeemed: 7 })).toBe("usedUp");
  });

  it("treats an unlimited coupon as live however many times it has been used", () => {
    // `maxRedemptions: null` is unlimited, which is not zero — a comparison
    // that got that backwards would retire every open-ended promotion.
    expect(couponState({ ...base, maxRedemptions: null, timesRedeemed: 9999 })).toBe("live");
  });

  it("expires on the date passing, not on the row changing", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

    expect(couponState({ ...base, expiresAt: yesterday })).toBe("expired");
    expect(couponState({ ...base, expiresAt: tomorrow })).toBe("live");
  });

  it("reports a switched-off coupon as off even when it has also expired", () => {
    /*
     * Precedence, and it is the seller's own action that wins. "You turned this
     * off" is a thing they did; "it expired" is a thing that happened to them,
     * and reporting the second hides the first behind a date they would then go
     * and change for no effect.
     */
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(couponState({ ...base, isActive: false, expiresAt: yesterday })).toBe("off");
  });
});

describe("railTone", () => {
  /*
   * Typed as the wire shape rather than inferred, so a field added to
   * `RailSetting` fails here instead of leaving this fixture quietly
   * describing a rail the server no longer sends.
   */
  const base: Rail = {
    type: "venmo",
    category: "wallet",
    name: "Venmo",
    description: "",
    currencies: ["USD"],
    fields: [],
    label: null,
    config: {},
    isEnabled: false,
    position: 0,
    configured: false,
    available: true,
    usable: false,
  };

  it("is a success only when a buyer could actually pay through it", () => {
    expect(railTone({ ...base, usable: true })).toBe("success");
  });

  it("warns about a rail the seller switched on that still does not work", () => {
    /*
     * The dangerous state, and the only one that earns a warning: the seller
     * believes this is live — their own toggle says so — and the storefront is
     * rendering a button that takes a buyer nowhere.
     */
    expect(railTone({ ...base, isEnabled: true, usable: false })).toBe("warning");
  });

  it("stays neutral about a rail nobody has set up", () => {
    // Not a problem. Most rails are off in most shops, and a screen of amber
    // pills is a screen that has stopped meaning anything.
    expect(railTone({ ...base, isEnabled: false, usable: false })).toBe("neutral");
  });

  it("does not warn about a rail the currency rules out, even when enabled", () => {
    /*
     * A rail that cannot settle the shop's currency is not something the seller
     * can fix, so warning about it is an alarm with no action behind it. This
     * is the case that made three booleans necessary instead of one.
     */
    expect(railTone({ ...base, isEnabled: true, available: false, usable: false })).toBe(
      "neutral",
    );
  });
});

describe("formatConversion", () => {
  it("renders no views as an em dash and never as zero per cent", () => {
    /*
     * The distinction the whole column exists for. `0%` is people looked and
     * nobody bought — a product with a problem. Null is nobody looked — a
     * product with a marketing problem. A seller sent to rewrite a description
     * that was never read loses an afternoon.
     */
    expect(formatConversion(null)).toBe("—");
    expect(formatConversion(0)).toBe("0%");
  });

  it("drops a trailing zero rather than printing false precision", () => {
    // "10%" and not "10.0%": the second implies a measurement finer than
    // orders-over-views can produce at these counts.
    expect(formatConversion(0.1)).toBe("10%");
    expect(formatConversion(0.125)).toBe("12.5%");
  });

  it("keeps a small rate visible instead of rounding it away", () => {
    // One order in a thousand views is 0.1%, which is a real number a seller
    // acts on. Rounding to whole percents would print it as 0%.
    expect(formatConversion(0.001)).toBe("0.1%");
  });
});
