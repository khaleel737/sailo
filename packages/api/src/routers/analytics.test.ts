import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The plan gate, checked where a client can reach it.
 *
 * `resolveAnalyticsWindow` has its own tests in @sailo/analytics; what is
 * tested here is that these procedures actually run it — that a window arrives
 * from a phone the same way it arrives from a query string, and is cut to the
 * plan before it reaches a query. That failure mode is the reason this file
 * exists: an unclamped window does not throw and does not look wrong. It
 * returns rows, just more of them than were paid for.
 *
 * The queries themselves are stubbed. What they do with a window is their
 * package's business and is tested there; what matters here is *which* window
 * they are handed, and which shop id goes with it.
 */

const findFirst = vi.fn();

vi.mock("@sailo/db", () => ({
  // Only the shop read, which is this router's own. The analytics queries reach
  // the replica rather than this handle, and they are stubbed below.
  getDb: () => ({ query: { shops: { findFirst } } }),
}));

const getDashboardStats = vi.fn();
const getVisitSeries = vi.fn();
const getRevenueSeries = vi.fn();
const getVisitBreakdown = vi.fn();
const getClickBreakdown = vi.fn();
const getProductPerformance = vi.fn();

vi.mock("@sailo/analytics/queries", () => ({
  getDashboardStats,
  getVisitSeries,
  getRevenueSeries,
  getVisitBreakdown,
  getClickBreakdown,
  getProductPerformance,
}));

// Tagged the way router.test.ts tags them, so the predicate each query builds
// can be read back — a shop lookup that took an id from the client rather than
// from the context would show up right here.
vi.mock("drizzle-orm", async (importActual) => ({
  ...(await importActual<typeof import("drizzle-orm")>()),
  eq: (column: unknown, value: unknown) => ({ __eq: { column, value } }),
}));

/*
 * Mounted alone rather than reached through `appRouter`.
 *
 * `routers/` was split so that a file could be worked on without the other
 * nine in the way, and a per-router test that loads all ten gives that up: it
 * fails whenever a neighbour is mid-change, and every module any of them opens
 * has to be stubbed here to keep this file green. Both have already happened
 * once each while this was being written.
 *
 * Nothing is lost by mounting one. `shopProcedure` is the same middleware
 * either way, and that the namespace is on the composed router is `router.ts`'s
 * property — asserted in `router.test.ts`, beside the composition itself.
 */
const { router } = await import("../trpc");
const { analyticsRouter } = await import("./analytics");
const appRouter = router({ analytics: analyticsRouter });

function scopedValueOf(where: unknown): unknown {
  return (where as { __eq?: { value?: unknown } })?.__eq?.value;
}

/** A shop on the free plan — thirty days of analytics. */
const FREE = { plan: "free", subscriptionStatus: null, compPlan: null };
/** Business — three years. */
const BUSINESS = { plan: "business", subscriptionStatus: "active", compPlan: null };

/** Today, so a "to" bound is never accidentally in the future. */
const today = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  findFirst.mockReset();
  getDashboardStats.mockReset().mockResolvedValue({});
  getVisitSeries.mockReset().mockResolvedValue([]);
  getRevenueSeries.mockReset().mockResolvedValue([]);
  getVisitBreakdown.mockReset().mockResolvedValue({});
  getClickBreakdown.mockReset().mockResolvedValue({});
  getProductPerformance
    .mockReset()
    .mockResolvedValue({ rows: [], total: 0, page: 1, perPage: 50 });
});

describe("analytics procedures", () => {
  it("refuses every read when no shop resolved", async () => {
    const caller = appRouter.createCaller({ shopId: null });
    await expect(caller.analytics.stats()).rejects.toThrow(/sign in/i);
    await expect(caller.analytics.series()).rejects.toThrow(/sign in/i);
    await expect(caller.analytics.breakdown()).rejects.toThrow(/sign in/i);
    await expect(caller.analytics.products()).rejects.toThrow(/sign in/i);
    expect(findFirst).not.toHaveBeenCalled();
    expect(getDashboardStats).not.toHaveBeenCalled();
  });

  it("reads the plan from the caller's own shop row, never from the request", async () => {
    findFirst.mockResolvedValue(FREE);
    await appRouter.createCaller({ shopId: "shop_A" }).analytics.stats();
    expect(scopedValueOf(findFirst.mock.calls[0]?.[0]?.where)).toBe("shop_A");
    expect(getDashboardStats).toHaveBeenCalledWith("shop_A", expect.anything());
  });

  it("answers NOT_FOUND when the shop row is gone", async () => {
    findFirst.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller({ shopId: "shop_gone" }).analytics.stats(),
    ).rejects.toThrow(/no such shop/i);
  });

  it("clamps a business-length preset asked for by a free shop", async () => {
    findFirst.mockResolvedValue(FREE);
    const result = await appRouter
      .createCaller({ shopId: "shop_1" })
      // 1095 days is the business allowance. A free shop may not have it.
      .analytics.stats({ range: 1095 });

    expect(result.window.days).toBe(30);
    // The clamp reached the query, not just the response: this is the
    // assertion that would have caught a window resolved and then ignored.
    expect(getDashboardStats).toHaveBeenCalledWith("shop_1", 30);
  });

  it("honours the same preset for a shop that pays for it", async () => {
    findFirst.mockResolvedValue(BUSINESS);
    const result = await appRouter
      .createCaller({ shopId: "shop_2" })
      .analytics.stats({ range: 1095 });

    expect(result.window.days).toBe(1095);
    expect(getDashboardStats).toHaveBeenCalledWith("shop_2", 1095);
  });

  it("pulls a custom range forward to the plan's floor, and says it did", async () => {
    findFirst.mockResolvedValue(FREE);
    const result = await appRouter
      .createCaller({ shopId: "shop_1" })
      .analytics.stats({ from: "2020-01-01", to: today() });

    expect(result.window.clamped).toBe(true);
    expect(result.window.custom).toBe(true);
    // Thirty days of allowance: twenty-nine back, plus today.
    expect(result.window.days).toBe(30);

    // And the query was given the clamped bounds rather than the asked-for ones.
    const passed = getDashboardStats.mock.calls[0]?.[1] as { since: Date };
    expect(passed.since.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it("caps the chart at sixty bars and admits it", async () => {
    findFirst.mockResolvedValue(BUSINESS);
    const result = await appRouter
      .createCaller({ shopId: "shop_2" })
      .analytics.series({ range: 365 });

    // The tiles still count the whole year the seller asked for...
    expect(result.window.days).toBe(365);
    // ...while the chart says it is showing the recent sixty days of it.
    expect(result.chart.days).toBe(60);
    expect(result.chart.truncated).toBe(true);
    expect(getVisitSeries).toHaveBeenCalledWith("shop_2", 60);
    expect(getRevenueSeries).toHaveBeenCalledWith("shop_2", 60);
  });

  it("does not claim truncation when the window fits", async () => {
    findFirst.mockResolvedValue(BUSINESS);
    const result = await appRouter
      .createCaller({ shopId: "shop_2" })
      .analytics.series({ range: 30 });

    expect(result.chart.truncated).toBe(false);
    expect(result.chart.days).toBe(30);
  });

  it("gives both breakdowns the full window, not the chart's", async () => {
    findFirst.mockResolvedValue(BUSINESS);
    await appRouter
      .createCaller({ shopId: "shop_2" })
      .analytics.breakdown({ range: 365 });

    expect(getVisitBreakdown).toHaveBeenCalledWith("shop_2", 365);
    expect(getClickBreakdown).toHaveBeenCalledWith("shop_2", 365);
  });

  it("pages the product table and reports the size of the whole", async () => {
    findFirst.mockResolvedValue(BUSINESS);
    getProductPerformance.mockResolvedValue({
      rows: [],
      total: 380,
      page: 3,
      perPage: 50,
    });

    const result = await appRouter
      .createCaller({ shopId: "shop_2" })
      .analytics.products({ range: 30, page: 3 });

    expect(getProductPerformance).toHaveBeenCalledWith("shop_2", 30, 3);
    // "Top 50 of 380" is renderable from this; "50 products" is not.
    expect(result).toMatchObject({ total: 380, page: 3, perPage: 50 });
  });

  it("sends dates as strings, because nothing transforms them on the way", async () => {
    findFirst.mockResolvedValue(BUSINESS);
    const result = await appRouter
      .createCaller({ shopId: "shop_2" })
      .analytics.stats({ range: 30 });

    expect(typeof result.window.since).toBe("string");
    expect(typeof result.window.until).toBe("string");
    expect(result.window.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
