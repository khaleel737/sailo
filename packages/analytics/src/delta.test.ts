import { describe, expect, it } from "vitest";
import { MIN_BASE_FOR_PERCENT, deltaPercent } from "./delta";

describe("deltaPercent", () => {
  it("takes an honest ratio of a real base", () => {
    expect(deltaPercent(112, 100)).toBe(12);
    expect(deltaPercent(88, 100)).toBe(-12);
    expect(deltaPercent(100, 100)).toBe(0);
  });

  it("refuses the tiny-base blow-up", () => {
    // 1 → 211 is "+21000%", a number the HQ overview really did display.
    expect(deltaPercent(211, 1)).toBeNull();
    expect(deltaPercent(211, 0)).toBeNull();
    expect(deltaPercent(5, MIN_BASE_FOR_PERCENT - 1)).toBeNull();
  });

  it("allows the base exactly at the floor", () => {
    expect(deltaPercent(20, MIN_BASE_FOR_PERCENT)).toBe(100);
  });
});
