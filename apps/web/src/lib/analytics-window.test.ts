import { describe, expect, it } from "vitest";
import { resolveAnalyticsWindow } from "./analytics-window";

/**
 * The window resolver is the plan gate for custom ranges: whatever a
 * hand-typed URL asks for, what comes out must fit the plan's allowance.
 */

/** A shop on the free plan — 30 days of analytics. */
const freeShop = { plan: "free", subscriptionStatus: null } as const;
/** Business — three years. */
const bizShop = { plan: "business", subscriptionStatus: "active" } as const;

const now = new Date("2026-08-10T14:30:00Z");

describe("resolveAnalyticsWindow", () => {
  it("keeps presets exactly as they were", () => {
    const window = resolveAnalyticsWindow(freeShop, { range: "7" }, now);
    expect(window).toMatchObject({ query: 7, days: 7, custom: false });
  });

  it("resolves a custom range to the half-open UTC window", () => {
    const window = resolveAnalyticsWindow(
      bizShop,
      { from: "2026-07-01", to: "2026-07-31" },
      now,
    );
    expect(window.custom).toBe(true);
    expect(window.clamped).toBe(false);
    expect(window.since.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    // Exclusive end: the 31st is included by ending at August 1st.
    expect(window.until.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(window.days).toBe(31);
  });

  it("clamps a free shop reaching past its 30 days, and says so", () => {
    const window = resolveAnalyticsWindow(
      freeShop,
      { from: "2025-08-10", to: "2026-08-10" },
      now,
    );
    expect(window.custom).toBe(true);
    expect(window.clamped).toBe(true);
    // 30 days of allowance = 29 back plus today.
    expect(window.since.toISOString()).toBe("2026-07-12T00:00:00.000Z");
  });

  it("does not let a range run into the future", () => {
    const window = resolveAnalyticsWindow(
      bizShop,
      { from: "2026-08-01", to: "2026-12-31" },
      now,
    );
    expect(window.until.toISOString()).toBe("2026-08-11T00:00:00.000Z");
  });

  it("falls back to the preset for garbage, inverted or out-of-reach ranges", () => {
    for (const params of [
      { from: "not-a-date", to: "2026-08-01" },
      { from: "2026-08-05", to: "2026-08-01" },
      // A date that only parses by rolling over into the next month.
      { from: "2026-02-31", to: "2026-03-31" },
      // Entirely before a free plan's allowance.
      { from: "2024-01-01", to: "2024-02-01" },
      // Entirely in the future.
      { from: "2027-01-01", to: "2027-02-01" },
    ]) {
      const window = resolveAnalyticsWindow(freeShop, params, now);
      expect(window.custom, JSON.stringify(params)).toBe(false);
      expect(window.query).toBe(30);
    }
  });

  it("still clamps the preset path, as before", () => {
    const window = resolveAnalyticsWindow(freeShop, { range: "365" }, now);
    expect(window.query).toBe(30);
  });
});
