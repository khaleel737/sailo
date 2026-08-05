import { describe, expect, it } from "vitest";
import {
  couponFor,
  couponReducer,
  NO_COUPON,
  type CouponState,
} from "./coupon-state";

/**
 * Four `useState` calls used to carry this, and nothing stopped them
 * disagreeing: a code shown as applied beside an error explaining why it
 * isn't, or a spinner still running after a rejection. These pin that every
 * transition moves all four together.
 */

const reduce = (state: CouponState, ...actions: Parameters<typeof couponReducer>[1][]) =>
  actions.reduce(couponReducer, state);

describe("couponReducer", () => {
  it("clears the old complaint as soon as the buyer types", () => {
    const rejected = reduce(NO_COUPON, { type: "rejected", message: "Expired" });
    expect(rejected.error).toBe("Expired");

    const typing = couponReducer(rejected, { type: "typed", value: "SUMMER" });
    // Leaving it up would attach the last code's error to the new attempt.
    expect(typing.error).toBeNull();
    expect(typing.input).toBe("SUMMER");
  });

  it("keeps the typed code after a rejection, because it is usually a typo", () => {
    const state = reduce(
      NO_COUPON,
      { type: "typed", value: "SUMER" },
      { type: "checking" },
      { type: "rejected", message: "No such code" },
    );
    expect(state.input).toBe("SUMER");
    expect(state.applied).toBe("");
  });

  it("never leaves the spinner running", () => {
    for (const action of [
      { type: "rejected", message: "x" },
      { type: "applied", code: "X" },
      { type: "cleared" },
      { type: "lapsed", message: "x" },
    ] as const) {
      const state = couponReducer({ ...NO_COUPON, checking: true }, action);
      expect(state.checking).toBe(false);
    }
  });

  it("never shows a code as applied and errored at once", () => {
    const applied = reduce(
      NO_COUPON,
      { type: "typed", value: "SUMMER" },
      { type: "applied", code: "SUMMER" },
    );
    expect(applied.applied).toBe("SUMMER");
    expect(applied.error).toBeNull();
  });

  it("explains itself when the basket stops qualifying", () => {
    const applied = couponReducer(NO_COUPON, { type: "applied", code: "SUMMER" });
    const lapsed = couponReducer(applied, {
      type: "lapsed",
      message: "Spend $50 to use this code",
    });

    // Dropping it silently would look like the total quietly went up.
    expect(lapsed.applied).toBe("");
    expect(lapsed.error).toBe("Spend $50 to use this code");
    // Restored, so re-applying is one click once the basket qualifies again.
    expect(lapsed.input).toBe("SUMMER");
  });

  it("resets everything when the buyer removes the code themselves", () => {
    const state = reduce(
      NO_COUPON,
      { type: "typed", value: "SUMMER" },
      { type: "applied", code: "SUMMER" },
      { type: "cleared" },
    );
    expect(state).toEqual(NO_COUPON);
  });
});

describe("couponFor", () => {
  it("sends nothing rather than an empty code", () => {
    // "" would be a code the server has to reject, not the absence of one.
    expect(couponFor(NO_COUPON)).toBeUndefined();
    expect(couponFor({ ...NO_COUPON, input: "TYPED" })).toBeUndefined();
  });

  it("sends only a code that was actually accepted", () => {
    expect(couponFor({ ...NO_COUPON, applied: "SUMMER" })).toBe("SUMMER");
  });
});
