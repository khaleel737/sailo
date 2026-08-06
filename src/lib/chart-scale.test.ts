import { describe, expect, it } from "vitest";
import {
  barRect,
  chartDomain,
  hasData,
  peakIndex,
  toPercent,
  type Series,
} from "./chart-scale";

const line = (key: string, values: number[]): Series => ({
  key,
  label: key,
  shape: "line",
  values,
});
const bars = (key: string, values: number[], negative = false): Series => ({
  key,
  label: key,
  shape: "bar",
  values,
  negative,
});

describe("chartDomain", () => {
  it("always contains zero, so a flat week is not dramatised", () => {
    // Scaled to min..max, 90 would sit on the floor and this would read as a
    // crash. Anchored at zero, it reads as the flat week it is.
    const d = chartDomain([bars("sales", [90, 95, 100])]);
    expect(d.min).toBe(0);
    expect(toPercent(90, d)).toBeCloseTo(10);
  });

  it("shares one domain across every series", () => {
    // The whole point of one domain: a tiny refund must not be drawn at the
    // same height as a large sale just because it is the biggest of its kind.
    const d = chartDomain([bars("sales", [5000]), bars("refunds", [5], true)]);
    expect(d.max).toBe(5000);
    expect(toPercent(5, d)).toBeGreaterThan(90);
  });

  it("opens the domain downwards for a series marked negative", () => {
    const d = chartDomain([bars("sales", [100]), bars("refunds", [40], true)]);
    expect(d.max).toBe(100);
    expect(d.min).toBe(-40);
  });

  it("takes a negative series as an amount, whatever its sign", () => {
    // Refunds are stored as a positive amount refunded. Passing them already
    // negated must not flip them back above the axis.
    const stored = chartDomain([bars("refunds", [40], true)]);
    const negated = chartDomain([bars("refunds", [-40], true)]);
    expect(stored).toEqual(negated);
    expect(stored.min).toBe(-40);
  });

  it("survives an empty chart and a chart of zeroes", () => {
    for (const series of [[], [line("x", [])], [line("x", [0, 0])]]) {
      const d = chartDomain(series);
      expect(Number.isFinite(toPercent(0, d))).toBe(true);
      expect(Number.isFinite(barRect(0, d).height)).toBe(true);
    }
  });
});

describe("barRect", () => {
  /*
   * The bug this module exists for. A day whose refunds outweighed its sales
   * used to render as a 1.5% grey stub — pixel for pixel what a day with no
   * sales at all looked like.
   */
  it("hangs a losing day below the zero line, not on the floor", () => {
    const d = chartDomain([bars("net", [100, -50])]);
    const loss = barRect(-50, d);
    const nothing = barRect(0, d);

    expect(loss.top).toBeGreaterThanOrEqual(toPercent(0, d));
    expect(loss.height).toBeGreaterThan(nothing.height * 5);
  });

  it("does not draw a losing day and an empty day the same", () => {
    const d = chartDomain([bars("net", [100, -50, 0])]);
    expect(barRect(-50, d)).not.toEqual(barRect(0, d));
  });

  it("places the baseline proportionally", () => {
    // Domain -50..150 is 200 tall; zero sits three quarters of the way down.
    const d = chartDomain([bars("net", [150, -50])]);
    expect(toPercent(0, d)).toBeCloseTo(75);
  });

  it("never draws a real value as nothing", () => {
    // One cent beside a million must still be visible, or the chart says the
    // day was empty when it was not.
    const d = chartDomain([bars("sales", [1_000_000, 1])]);
    expect(barRect(1, d).height).toBeGreaterThanOrEqual(3);
  });
});

describe("peakIndex", () => {
  it("finds the largest day across every series", () => {
    expect(peakIndex([line("a", [1, 2, 3]), line("b", [0, 9, 0])])).toBe(1);
  });

  it("calls out the worst day when the loss is the story", () => {
    expect(peakIndex([line("net", [10, -80, 20])])).toBe(1);
  });

  it("does not throw on nothing at all", () => {
    expect(peakIndex([])).toBe(0);
    expect(peakIndex([line("a", [])])).toBe(0);
  });
});

describe("hasData", () => {
  it("is false only when every series is empty or flat zero", () => {
    expect(hasData([])).toBe(false);
    expect(hasData([line("a", [0, 0])])).toBe(false);
    expect(hasData([line("a", [0, 0]), line("b", [0, 1])])).toBe(true);
    // A refund-only window is still data worth drawing.
    expect(hasData([bars("refunds", [30], true)])).toBe(true);
  });
});
