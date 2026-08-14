import { describe, expect, it } from "vitest";
import { chartWindow, MAX_CHART_BARS, resolveAnalyticsWindow } from "./analytics-window";

/**
 * The chart cap, checked against the same rule the admin overview has applied
 * inline since custom ranges existed. These assertions are the contract the
 * mobile Insights tab reads: what the series covers, and whether it is the
 * whole window or the tail of one.
 */

const bizShop = { plan: "business", subscriptionStatus: "active" } as const;
const now = new Date("2026-08-10T14:30:00Z");

const DAY_MS = 24 * 60 * 60 * 1000;

describe("chartWindow", () => {
  it("leaves a preset shorter than the cap exactly as it was", () => {
    const chart = chartWindow(resolveAnalyticsWindow(bizShop, { range: "30" }, now));
    // Still a rolling day-count, so the series queries build the query they
    // built before any of this existed.
    expect(chart.query).toBe(30);
    expect(chart.days).toBe(30);
    expect(chart.truncated).toBe(false);
  });

  it("cuts a long preset down to the cap, and says so", () => {
    const chart = chartWindow(resolveAnalyticsWindow(bizShop, { range: "365" }, now));
    expect(chart.query).toBe(MAX_CHART_BARS);
    expect(chart.days).toBe(MAX_CHART_BARS);
    expect(chart.truncated).toBe(true);
  });

  it("leaves a custom window inside the cap alone", () => {
    const window = resolveAnalyticsWindow(
      bizShop,
      { from: "2026-07-01", to: "2026-07-31" },
      now,
    );
    const chart = chartWindow(window);
    expect(chart.truncated).toBe(false);
    expect(chart.days).toBe(31);
    expect(chart.since).toEqual(window.since);
    expect(chart.until).toEqual(window.until);
  });

  it("keeps the recent end of a custom window, not the old one", () => {
    const window = resolveAnalyticsWindow(
      bizShop,
      { from: "2025-01-01", to: "2026-08-09" },
      now,
    );
    const chart = chartWindow(window);
    expect(chart.truncated).toBe(true);
    expect(chart.days).toBe(MAX_CHART_BARS);
    /*
     * The near edge moves forward, the far edge does not. A seller who asked
     * for eighteen months and got sixty bars should be reading the most recent
     * sixty days — showing them the oldest sixty instead would be a chart of
     * early 2025 sitting under tiles counting all of it.
     */
    expect(chart.until).toEqual(window.until);
    expect(chart.until.getTime() - chart.since.getTime()).toBe(
      MAX_CHART_BARS * DAY_MS,
    );
  });

  it("reports a clamped window's own length, not the length asked for", () => {
    // Free plan, a year requested: the resolver pulls it forward to 30 days,
    // so there is nothing left for the chart cap to do.
    const freeShop = { plan: "free", subscriptionStatus: null } as const;
    const window = resolveAnalyticsWindow(
      freeShop,
      { from: "2025-08-10", to: "2026-08-10" },
      now,
    );
    const chart = chartWindow(window);
    expect(window.clamped).toBe(true);
    expect(chart.truncated).toBe(false);
    expect(chart.days).toBe(window.days);
  });
});
