import { describe, expect, it } from "vitest";
import { chartScale, peakIndex, type Point } from "./chart-scale";

const days = (...values: number[]): Point[] =>
  values.map((value, i) => ({ day: `2026-08-${String(i + 1).padStart(2, "0")}`, value }));

describe("chartScale", () => {
  it("puts the baseline on the floor when nothing is negative", () => {
    const s = chartScale(days(0, 5, 10));
    expect(s.zeroY).toBe(100);
    expect(s.y(10)).toBe(0);
    expect(s.y(0)).toBe(100);
  });

  it("keeps zero inside the domain so small variation is not dramatised", () => {
    // Scaled to min..max, 90 would sit on the floor and this would read as a
    // crash. Anchored at zero, it reads as the flat week it is.
    const s = chartScale(days(90, 95, 100));
    expect(s.lo).toBe(0);
    expect(s.y(90)).toBeCloseTo(10);
  });

  it("survives a series that is entirely zero", () => {
    const s = chartScale(days(0, 0, 0));
    expect(Number.isFinite(s.y(0))).toBe(true);
    expect(Number.isFinite(s.bar(0).height)).toBe(true);
  });

  it("survives an empty series", () => {
    const s = chartScale([]);
    expect(Number.isFinite(s.zeroY)).toBe(true);
    expect(s.x(0)).toBe(50);
  });

  describe("negative days", () => {
    /*
     * The bug this whole module exists for. A day whose refunds outweighed its
     * sales used to render as a 1.5% grey stub — pixel for pixel what a day
     * with no sales at all looked like.
     */
    it("hangs a losing day below the zero line, not on the floor", () => {
      const s = chartScale(days(100, -50));
      const loss = s.bar(-50);
      const nothing = s.bar(0);

      expect(loss.top).toBeGreaterThanOrEqual(s.zeroY);
      expect(loss.height).toBeGreaterThan(nothing.height * 5);
    });

    it("a losing day and a zero day are not drawn the same", () => {
      const s = chartScale(days(100, -50, 0));
      expect(s.bar(-50)).not.toEqual(s.bar(0));
    });

    it("places the baseline proportionally", () => {
      // Domain -50..150 is 200 tall; zero sits three quarters of the way down.
      const s = chartScale(days(150, -50));
      expect(s.span).toBe(200);
      expect(s.zeroY).toBeCloseTo(75);
    });

    it("handles a window that only lost money", () => {
      const s = chartScale(days(-10, -20));
      expect(s.hi).toBe(0);
      expect(s.zeroY).toBe(0);
      expect(s.bar(-20).height).toBeCloseTo(100);
    });
  });

  it("never draws a real value as nothing", () => {
    // One cent beside a million must still be visible, or the chart says the
    // day was empty when it was not.
    const s = chartScale(days(1_000_000, 1));
    expect(s.bar(1).height).toBeGreaterThanOrEqual(3);
  });

  it("spreads columns across the full width", () => {
    const s = chartScale(days(1, 2, 3));
    expect(s.x(0)).toBe(0);
    expect(s.x(2)).toBe(100);
  });
});

describe("peakIndex", () => {
  it("finds the largest day", () => {
    expect(peakIndex(days(1, 9, 3))).toBe(1);
  });

  it("calls out the worst day when the loss is the story", () => {
    expect(peakIndex(days(10, -80, 20))).toBe(1);
  });

  it("does not throw on an empty series", () => {
    expect(peakIndex([])).toBe(0);
  });
});
