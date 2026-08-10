import {
  analyticsLimit,
  clampAnalyticsRange,
} from "@/lib/plans";

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
