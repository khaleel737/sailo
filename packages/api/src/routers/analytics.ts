import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import {
  chartWindow,
  resolveAnalyticsWindow,
  type AnalyticsWindow,
} from "@sailo/analytics/window";
import {
  getClickBreakdown,
  getDashboardStats,
  getProductPerformance,
  getRevenueSeries,
  getVisitBreakdown,
  getVisitSeries,
} from "@sailo/analytics/queries";
import { router, shopProcedure } from "../trpc";
import { found } from "../shared";

/**
 * The shop's own numbers: what sold, who visited, where they came from.
 *
 * Every read here goes through `@sailo/analytics`, which is the same module
 * the admin dashboard reads — so the Insights tab and the overview page cannot
 * come to different conclusions about the same shop and the same fortnight.
 */

/**
 * The window, spelled the way a URL spells it.
 *
 * `range`, `from` and `to` are the admin dashboard's query parameters, handed
 * to the same resolver in the same shape on purpose. The resolver already
 * decides what a malformed date, an inverted range or an unknown preset means
 * — it ignores them and serves the default — and validating them a second time
 * here with zod would have given the phone different behaviour from the web
 * page for the same input. One clamp, one set of rules, two callers.
 *
 * `range` is a number on this side because the client is typed and a segmented
 * control has no reason to hold "30" as text; it is stringified below to reach
 * the resolver unchanged.
 */
const windowShape = {
  /** A preset, in days. Anything not on the plan's list falls back. */
  range: z.number().int().positive().optional(),
  /** `YYYY-MM-DD`, inclusive. */
  from: z.string().optional(),
  /** `YYYY-MM-DD`, inclusive — the resolver makes the bound exclusive. */
  to: z.string().optional(),
};

const windowInput = z.object(windowShape).optional();

const productsInput = z
  .object({ ...windowShape, page: z.number().int().min(1).optional() })
  .optional();

type WindowInput = z.infer<typeof windowInput>;

/**
 * The window this caller is allowed, resolved from their own plan.
 *
 * The plan is read from the database on every call rather than taken from the
 * request, which is the whole point: an entitlement the client can state is an
 * entitlement the client can raise. It is a three-column read of one indexed
 * row, and each procedure does its own — a batched Insights load pays for four
 * of them. That is the cost of never having a procedure that trusts a window
 * somebody else resolved, and it is the right trade: reading too far back
 * fails silently, because a window that is too wide still returns rows.
 */
async function allowedWindow(
  shopId: string,
  input: WindowInput,
): Promise<AnalyticsWindow> {
  const shop = found(
    await getDb().query.shops.findFirst({
      where: eq(shops.id, shopId),
      columns: { plan: true, subscriptionStatus: true, compPlan: true },
    }),
    "shop",
  );

  return resolveAnalyticsWindow(shop, {
    range: input?.range === undefined ? undefined : String(input.range),
    from: input?.from,
    to: input?.to,
  });
}

/**
 * What the response says about the window it answered for.
 *
 * `clamped` is the honest half. A seller on the free plan who asks for a year
 * gets thirty days, and a screen that did not know it had been cut would draw
 * that as a year in which nothing happened. A09 renders this as the upgrade
 * nudge, the way the web dashboard already does.
 *
 * Dates leave as ISO strings, deliberately. There is no transformer on the
 * mobile client — see the note on `createApiClient` — so a `Date` here would
 * be typed as a Date and arrive as a string, which is the one mismatch the
 * compiler cannot catch. Stringifying at the edge makes the type tell the
 * truth.
 */
function windowMeta(window: AnalyticsWindow) {
  return {
    days: window.days,
    custom: window.custom,
    /** The requested range reached past the plan and was pulled forward. */
    clamped: window.clamped,
    since: window.since.toISOString(),
    /** Exclusive: the last day covered is the day before this. */
    until: window.until.toISOString(),
  };
}

export const analyticsRouter = router({
  /** The tiles: visits, orders, revenue, and what still needs doing. */
  stats: shopProcedure.input(windowInput).query(async ({ ctx, input }) => {
    const window = await allowedWindow(ctx.shopId, input);
    return {
      window: windowMeta(window),
      stats: await getDashboardStats(ctx.shopId, window.query),
    };
  }),

  /**
   * The two charts, over the sixty most recent days of the window.
   *
   * Both series come back from one call because they are drawn as one pair and
   * a screen holding a month of visits beside a fortnight of revenue would be
   * a bug nobody could see. `chart.truncated` says when the window outran the
   * axis, so the caller can label which sixty days these are rather than
   * implying they are the whole range the tiles counted.
   */
  series: shopProcedure.input(windowInput).query(async ({ ctx, input }) => {
    const window = await allowedWindow(ctx.shopId, input);
    const chart = chartWindow(window);

    const [visits, revenue] = await Promise.all([
      getVisitSeries(ctx.shopId, chart.query),
      getRevenueSeries(ctx.shopId, chart.query),
    ]);

    return {
      window: windowMeta(window),
      chart: {
        days: chart.days,
        /** The window is longer than the chart plots; this is its recent tail. */
        truncated: chart.truncated,
        since: chart.since.toISOString(),
        until: chart.until.toISOString(),
      },
      visits,
      revenue,
    };
  }),

  /**
   * Where visitors came from and where they went next.
   *
   * Both breakdowns cover the full window rather than the chart's sixty days —
   * they are rankings, not a time series, and a seller reading "Instagram
   * beats Google" means over the period they asked for.
   */
  breakdown: shopProcedure.input(windowInput).query(async ({ ctx, input }) => {
    const window = await allowedWindow(ctx.shopId, input);

    const [visits, clicks] = await Promise.all([
      getVisitBreakdown(ctx.shopId, window.query),
      getClickBreakdown(ctx.shopId, window.query),
    ]);

    return { window: windowMeta(window), visits, clicks };
  }),

  /**
   * Views, orders, conversion and revenue per product.
   *
   * Paged, and the page says how big the whole is: `total` and `perPage` come
   * straight from the query, so a caller showing fifty rows can say "top 50 of
   * 380" instead of implying that is the catalogue.
   */
  products: shopProcedure.input(productsInput).query(async ({ ctx, input }) => {
    const window = await allowedWindow(ctx.shopId, input);
    return {
      window: windowMeta(window),
      ...(await getProductPerformance(ctx.shopId, window.query, input?.page ?? 1)),
    };
  }),
});
