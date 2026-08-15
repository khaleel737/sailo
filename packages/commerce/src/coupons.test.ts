import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a discount code may be, whoever is saving it.
 *
 * These rules were inside a `"use server"` function, which made them rules
 * about the web form. Two of them are not conveniences:
 *
 * **The percent ceiling.** `discountValue` holds basis points for a percentage
 * and minor units for a fixed amount, in one column. A percentage above 100 is
 * an order total below zero, and nothing downstream refuses it —
 * `couponDiscount` multiplies and `computeTotals` subtracts, so the buyer is
 * quoted a shop that owes them money.
 *
 * **The redemption counter.** `timesRedeemed` is absent from the update, which
 * is invisible in review and obvious in production: a seller fixing a typo in
 * a "first 50 customers" code would hand it back all fifty uses.
 */

const couponsFindFirst = vi.fn();

let updated: { values: unknown; where: unknown }[];
let inserted: unknown[];
/** What `.returning()` answers with, so "not found" can be exercised. */
let updateReturns: { id: string }[];

function thenable<T>(result: T, extra: Record<string, unknown> = {}) {
  return { ...extra, then: (resolve: (value: T) => unknown) => resolve(result) };
}

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    query: { coupons: { findFirst: couponsFindFirst } },
    update: () => ({
      set: (values: unknown) => ({
        where: (where: unknown) => ({
          returning: () => {
            updated.push({ values, where });
            return thenable(updateReturns);
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => ({
        returning: () => {
          inserted.push(values);
          return thenable([{ id: "new-coupon" }]);
        },
      }),
    }),
  }),
}));

const { saveCoupon } = await import("./coupons");

const BASE = {
  shopId: "shop-1",
  id: null,
  code: "SUMMER",
  discountType: "percent" as const,
  value: 10,
  minSubtotalCents: 0,
  maxRedemptions: null,
  expiresAt: null,
  isActive: true,
};

beforeEach(() => {
  updated = [];
  inserted = [];
  updateReturns = [{ id: "coupon-1" }];
  couponsFindFirst.mockResolvedValue(undefined);
});

describe("saveCoupon", () => {
  it("refuses a percentage over 100 rather than quoting a negative total", async () => {
    const result = await saveCoupon({ ...BASE, value: 120 });

    expect(result).toEqual({ ok: false, reason: "percent_too_high" });
    expect(inserted).toHaveLength(0);
  });

  it("allows a fixed amount larger than 100, which is minor units and not a percentage", async () => {
    // The same column, a different unit. A ceiling applied to both would refuse
    // any discount over one currency unit.
    const result = await saveCoupon({ ...BASE, discountType: "fixed", value: 5000 });

    expect(result.ok).toBe(true);
    expect((inserted[0] as { discountValue: number }).discountValue).toBe(5000);
  });

  it("converts a percentage to basis points exactly once", async () => {
    // One column, two units — so the conversion lives here rather than in each
    // caller, where the two would drift into a coupon worth 100× what it says.
    await saveCoupon({ ...BASE, value: 12.5 });

    expect((inserted[0] as { discountValue: number }).discountValue).toBe(1250);
  });

  it("normalises the code rather than storing what was typed", async () => {
    // Stored uppercase, because a buyer typing `summer` at checkout has to
    // match a seller who typed `Summer`.
    await saveCoupon({ ...BASE, code: " summer24 " });

    expect((inserted[0] as { code: string }).code).toBe("SUMMER24");
  });

  it("refuses a code too short to be worth having", async () => {
    expect(await saveCoupon({ ...BASE, code: "ab" })).toEqual({
      ok: false,
      reason: "code_too_short",
    });
  });

  it("refuses a discount of zero", async () => {
    expect(await saveCoupon({ ...BASE, value: 0 })).toEqual({
      ok: false,
      reason: "value_not_positive",
    });
  });

  it("names a clash instead of letting the unique index refuse it", async () => {
    /*
     * The index would catch it either way — as a driver error, which reaches
     * the seller as a save that failed with no hint that they already have this
     * code.
     */
    couponsFindFirst.mockResolvedValue({ id: "existing" });

    expect(await saveCoupon(BASE)).toEqual({ ok: false, reason: "code_taken" });
    expect(inserted).toHaveLength(0);
  });

  it("does not collide a coupon with itself when it is being edited", async () => {
    couponsFindFirst.mockResolvedValue(undefined);

    const result = await saveCoupon({ ...BASE, id: "coupon-1" });

    expect(result).toEqual({ ok: true, id: "coupon-1", created: false });
    // The exclusion is in the WHERE — `ne(id)` — so re-saving an unchanged code
    // is not read as a duplicate of the row being saved.
    expect(couponsFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.anything() }),
    );
  });

  it("never writes the redemption counter", async () => {
    /*
     * The bug this exists to prevent: an edit that reset `timesRedeemed` hands
     * a "first 50 customers" promotion back its fifty uses every time the
     * seller fixes a typo.
     */
    await saveCoupon({ ...BASE, id: "coupon-1" });
    expect(updated[0]?.values).not.toHaveProperty("timesRedeemed");

    await saveCoupon(BASE);
    expect(inserted[0]).not.toHaveProperty("timesRedeemed");
  });

  it("answers 'not found' for an id in another shop rather than creating one", async () => {
    // The update is scoped by shop in the WHERE, so a foreign id simply matches
    // nothing — and must not fall through to an insert.
    updateReturns = [];

    expect(await saveCoupon({ ...BASE, id: "someone-elses" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(inserted).toHaveLength(0);
  });

  it("floors a redemption cap at one rather than storing zero", async () => {
    // A cap of zero is a coupon that can never be used, which nobody means.
    await saveCoupon({ ...BASE, maxRedemptions: 0 });
    expect((inserted[0] as { maxRedemptions: number }).maxRedemptions).toBe(1);
  });

  it("keeps a null cap as null — unlimited is not zero", async () => {
    await saveCoupon({ ...BASE, maxRedemptions: null });
    expect((inserted[0] as { maxRedemptions: number | null }).maxRedemptions).toBeNull();
  });
});
