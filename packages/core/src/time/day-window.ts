/**
 * A run of whole days, built in UTC.
 *
 * WHY IT IS ONE FUNCTION NOW
 *
 * It was two, byte-identical: `@sailo/analytics/queries` for a shop's charts and
 * `apps/web/src/lib/hq/pagination` for the internal dashboards. Only one of them
 * carried the comment explaining the hazard, which is the worst way for a
 * duplicate to exist — the copy without the reasoning is the one somebody
 * "simplifies".
 *
 * THE HAZARD, RESTATED WHERE BOTH CALLERS CAN SEE IT
 *
 * Timestamps are stored as UTC wall-clock and Postgres `::date` truncates in
 * UTC, so the JavaScript buckets have to be built in UTC too. Using local
 * midnight silently drops today's bucket for anyone ahead of UTC — the chart
 * renders, the numbers are plausible, and the most recent day is missing for
 * every seller east of Greenwich.
 *
 * Not in `@sailo/analytics` because HQ's pagination needs it and HQ is not
 * analytics; not in `@sailo/db` because there is no query here. It is date
 * arithmetic, which is what `./time` is for — and not `./money`, where it briefly
 * landed because the first caller happened to be a revenue chart.
 */

export type DayWindow = {
  /** UTC midnight, `days - 1` days ago — the first bucket's start. */
  since: Date;
  /** `YYYY-MM-DD` for every day in the window, oldest first. */
  keys: string[];
};

/**
 * The last `days` days, inclusive of today.
 *
 * `days - 1` because a window of one day is today alone. Off by one here shows up
 * as a chart with an extra empty column on the left, which reads as a quiet day
 * rather than as a bug.
 */
export function utcDayWindow(days: number): DayWindow {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(since);
    day.setUTCDate(since.getUTCDate() + i);
    keys.push(day.toISOString().slice(0, 10));
  }
  return { since, keys };
}
