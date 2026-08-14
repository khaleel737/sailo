import {
  analyticsLimit,
  clampAnalyticsRange,
} from "@sailo/core/plans";

/**
 * The window a dashboard read covers.
 *
 * Two shapes because the two ways of asking are genuinely different. A preset
 * ("last 30 days") is a rolling window ending right now — the number is handed
 * to the queries unchanged, so preset behaviour is byte-for-byte what it was
 * before custom ranges existed. A custom range is a pair of calendar days,
 * resolved to the half-open UTC window [since, until).
 */
export type DateWindow = { since: Date; until: Date };

export type AnalyticsWindow = {
  /** What the query layer consumes: rolling day-count, or explicit window. */
  query: number | DateWindow;
  /** How many days the window spans, for chart caps and labels. */
  days: number;
  custom: boolean;
  /**
   * The requested `from` reached past the plan's allowance and was pulled
   * forward. The page uses this to show the upgrade nudge instead of quietly
   * serving less than was asked for.
   */
  clamped: boolean;
  /** Display bounds. For presets these describe the rolling window. */
  since: Date;
  /** Exclusive. The last day shown is the day before this. */
  until: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function utcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * A `YYYY-MM-DD` query param as a UTC midnight, or null.
 *
 * Round-tripped back to text after parsing: `2026-02-31` parses as March 3rd,
 * and a URL that says one thing while the page shows another is worse than
 * ignoring the param.
 */
function parseDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

/**
 * Resolves `?range=` / `?from=&to=` into the window the queries may serve.
 *
 * Clamping lives here, server-side, for the same reason `clampAnalyticsRange`
 * does: a hand-typed URL must not read further back than the plan paid for.
 * The free plan asking for a year gets the window pulled forward to its
 * allowance and `clamped: true`, which the page turns into the upgrade modal —
 * mirroring the CSV-export gate rather than silently truncating.
 */
export function resolveAnalyticsWindow(
  shop: Parameters<typeof analyticsLimit>[0],
  params: { range?: unknown; from?: unknown; to?: unknown },
  now: Date = new Date(),
): AnalyticsWindow {
  const preset = (): AnalyticsWindow => {
    const days = clampAnalyticsRange(
      shop,
      typeof params.range === "string" ? Number(params.range) || undefined : undefined,
    );
    return {
      query: days,
      days,
      custom: false,
      clamped: false,
      since: new Date(now.getTime() - days * DAY_MS),
      until: now,
    };
  };

  const from = parseDay(params.from);
  const to = parseDay(params.to);
  if (!from || !to || from.getTime() > to.getTime()) return preset();

  // Tomorrow's midnight: the exclusive bound that still includes today.
  const tomorrow = new Date(utcMidnight(now).getTime() + DAY_MS);
  const until = new Date(Math.min(to.getTime() + DAY_MS, tomorrow.getTime()));

  // The earliest day the plan allows, counted the way the presets count:
  // a 30-day allowance reaches back 29 days plus today.
  const floor = new Date(
    utcMidnight(now).getTime() - (analyticsLimit(shop) - 1) * DAY_MS,
  );
  const clamped = from.getTime() < floor.getTime();
  const since = clamped ? floor : from;

  // A window clamped into nothing (asked entirely before the allowance, or
  // entirely in the future) has no honest answer; fall back to the default.
  if (since.getTime() >= until.getTime()) return preset();

  return {
    query: { since, until },
    days: Math.round((until.getTime() - since.getTime()) / DAY_MS),
    custom: true,
    clamped,
    since,
    until,
  };
}

/**
 * How many bars a chart will plot. A three-year window is a legitimate thing
 * to ask a *table* for and an unreadable thing to draw, so the series reads
 * the most recent sixty days of it rather than every day at a pixel each.
 */
export const MAX_CHART_BARS = 60;

/**
 * The stretch of a window a chart actually draws.
 *
 * Split out of the admin overview, which has applied this rule inline since
 * custom ranges existed, because the phone's Insights tab has to apply the
 * same one — and a cap re-derived at the second call site is how two screens
 * come to disagree about which sixty days they are showing.
 *
 * `truncated` is the part that matters to a caller. A window longer than the
 * chart can plot is not an error and not something to hide: the tiles above
 * still count the whole range, so a chart quietly showing a different period
 * from the numbers beside it would be the page lying about its own axis. The
 * caller says so instead.
 */
export type ChartWindow = {
  /** What the series queries consume — the same two shapes as `query`. */
  query: number | DateWindow;
  days: number;
  /** The window outran the chart; this is its most recent tail. */
  truncated: boolean;
  since: Date;
  /** Exclusive, as everywhere else here. */
  until: Date;
};

export function chartWindow(window: AnalyticsWindow): ChartWindow {
  const days = Math.min(window.days, MAX_CHART_BARS);
  const truncated = window.days > MAX_CHART_BARS;

  /*
   * A preset stays a rolling day-count, so the series queries build exactly
   * the query they built before any of this existed. Only a custom window has
   * to be narrowed by hand, and it is narrowed at its *near* edge — a seller
   * who asked for last year and got a chart of last month should be looking
   * at the most recent month, not the oldest one.
   */
  if (!window.custom) {
    return {
      query: days,
      days,
      truncated,
      since: new Date(window.until.getTime() - days * DAY_MS),
      until: window.until,
    };
  }

  const until = window.until;
  const since = truncated
    ? new Date(until.getTime() - MAX_CHART_BARS * DAY_MS)
    : window.since;
  return { query: { since, until }, days, truncated, since, until };
}
