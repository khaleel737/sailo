import { describe, expect, it } from "vitest";
import type { Affiliate } from "@sailo/db/schema";
import { commissionBpFor } from "./commission";

/**
 * What an affiliate earns, in basis points. It sat inside createOrderIntent
 * where nothing could reach it, and it decides what a shop owes someone.
 */

const shop = { affiliateDefaultBp: 1000 };
const affiliate = (commissionBp: number | null): Affiliate =>
  ({ id: "aff_1", commissionBp }) as Affiliate;

describe("commissionBpFor", () => {
  it("pays nothing when no affiliate brought the order", () => {
    // null, not 0: there is nobody to pay, which is not a rate of zero.
    expect(commissionBpFor(null, shop)).toBeNull();
  });

  it("prefers the affiliate's own negotiated rate", () => {
    expect(commissionBpFor(affiliate(1500), shop)).toBe(1500);
  });

  it("falls back to the shop's default when they have no rate of their own", () => {
    expect(commissionBpFor(affiliate(null), shop)).toBe(1000);
  });

  it("honours a negotiated zero rather than reading it as unset", () => {
    /*
     * The case the `??` exists for. An affiliate deliberately on 0% — a
     * founder, a partner who is paid another way — must not silently inherit
     * the shop's default and start earning.
     */
    expect(commissionBpFor(affiliate(0), shop)).toBe(0);
  });

  it("honours a negotiated rate above the shop default", () => {
    expect(commissionBpFor(affiliate(2500), { affiliateDefaultBp: 500 })).toBe(2500);
  });

  it("returns the default even when the default is zero", () => {
    // A shop that pays nothing by default still records the affiliate.
    expect(commissionBpFor(affiliate(null), { affiliateDefaultBp: 0 })).toBe(0);
  });
});
