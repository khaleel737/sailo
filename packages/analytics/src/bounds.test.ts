import { describe, expect, it } from "vitest";
import { windowBounds, seriesWindow } from "./bounds";

/**
 * What a dashboard window means.
 *
 * Every figure a seller reads is scoped by these two functions, and until the 607-line
 * `queries.ts` was split they could not be tested at all — reaching them meant a replica
 * and five grouped scans.
 *
 * Both accept two shapes on purpose: a day-count is the rolling window the presets have
 * always been, and an explicit `{since, until}` is a custom range. The rule that matters is
 * that a number produces exactly what it produced before custom ranges existed — nobody's
 * "last 30 days" was allowed to change meaning when the feature landed.
 */

const DAY = 24 * 60 * 60 * 1000;

describe("windowBounds", () => {
  it("turns a day count into a start with no far edge", () => {
    const { since, until } = windowBounds(30);

    expect(until).toBeNull();
    expect(Date.now() - since.getTime()).toBeGreaterThan(29 * DAY);
    expect(Date.now() - since.getTime()).toBeLessThan(31 * DAY);
  });

  /*
   * `until: null` is what keeps a rolling window rolling. A far edge of "now" would freeze
   * the window at the moment the query was built, which for a dashboard that streams is
   * visibly wrong: an order placed while the page renders would fall outside it.
   */
  it("leaves a rolling window open at the top", () => {
    expect(windowBounds(7).until).toBeNull();
    expect(windowBounds(1).until).toBeNull();
  });

  it("passes an explicit range through untouched", () => {
    const range = { since: new Date("2026-06-01T00:00:00Z"), until: new Date("2026-07-01T00:00:00Z") };

    expect(windowBounds(range)).toBe(range);
  });

  it("treats a zero-day window as starting now rather than at the epoch", () => {
    // A preset of 0 should not silently mean "everything ever".
    const { since } = windowBounds(0);

    expect(Math.abs(Date.now() - since.getTime())).toBeLessThan(5_000);
  });
});

describe("seriesWindow", () => {
  it("gives a rolling window no explicit keys, because the day helper supplies them", () => {
    const { until } = seriesWindow(14);

    expect(until).toBeNull();
  });

  /*
   * A custom range is zero-filled from its own bounds. Without the keys a day with no
   * visits is simply absent from the result, and a chart that skips empty days draws a
   * quiet week as a straight line between two busy ones.
   */
  it("zero-fills every day of a custom range", () => {
    const { keys } = seriesWindow({
      since: new Date("2026-06-01T00:00:00Z"),
      until: new Date("2026-06-05T00:00:00Z"),
    });

    expect(keys).toEqual(["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"]);
  });

  /*
   * Half-open: `until` is the exclusive edge, matching `inWindow`'s `lt`. If the keys
   * included it, the chart would show a final day the query never counted — always empty,
   * always looking like an outage.
   */
  it("excludes the far edge, matching the query's own comparison", () => {
    const { keys } = seriesWindow({
      since: new Date("2026-06-01T00:00:00Z"),
      until: new Date("2026-06-02T00:00:00Z"),
    });

    expect(keys).toEqual(["2026-06-01"]);
  });

  it("produces nothing for an empty range rather than looping", () => {
    const same = new Date("2026-06-01T00:00:00Z");

    expect(seriesWindow({ since: same, until: same }).keys).toEqual([]);
  });

  it("uses date-only keys, which is what the grouped query returns", () => {
    const { keys } = seriesWindow({
      since: new Date("2026-06-01T00:00:00Z"),
      until: new Date("2026-06-03T00:00:00Z"),
    });

    for (const key of keys) expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /*
   * A month-long custom range is 30 or 31 keys, not 30.0416… — stepping by whole days from
   * a UTC midnight is what keeps this exact, and a DST-affected local midnight would not.
   */
  it("steps in whole days across a month boundary", () => {
    const { keys } = seriesWindow({
      since: new Date("2026-03-28T00:00:00Z"),
      until: new Date("2026-04-02T00:00:00Z"),
    });

    expect(keys).toEqual(["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31", "2026-04-01"]);
  });
});
