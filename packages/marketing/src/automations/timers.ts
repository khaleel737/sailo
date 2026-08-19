import type { TimerNode } from "./graph";

/**
 * When a waiting run wakes up.
 *
 * Pure, and separated from the runner for the reason `webhooks/policy.ts` was
 * separated from `deliver.ts`: this is arithmetic, and arithmetic that has
 * never been asserted anywhere is arithmetic that is wrong. Everything here
 * takes a clock and a timezone and returns an instant.
 *
 * **Wall-clock, in the shop's timezone.** "Nine in the morning" means nine in
 * the morning where the seller is, and `shops.timeZone` is the column that
 * already makes booking mean anything. Computing it in UTC would mail a Sydney
 * seller's list at three in the morning — and would do it correctly, which is
 * why nobody would find the bug until a customer complained.
 *
 * That makes DST the interesting case rather than an edge one. Twice a year a
 * local day is 23 or 25 hours long, and a `timeOfDay` timer that added
 * 86,400,000ms would drift an hour and stay drifted. So the two wall-clock
 * modes walk *candidate local dates* and solve each one back to an instant,
 * rather than adding any duration to the last one.
 */

/** One day, in ms. A UTC day — never a local one, which is the whole point. */
const DAY_MS = 86_400_000;

/**
 * The local wall-clock parts of an instant, in a named zone.
 *
 * `Intl` rather than any arithmetic on offsets: the offset for a zone is a
 * function of the instant, and every implementation that stores one and reuses
 * it is wrong for half the year. `en-CA` because its short date format is
 * `YYYY-MM-DD`, which parses without a second lookup table.
 */
function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // `24` is how `hour12: false` spells midnight in some ICU versions.
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: Math.max(0, WEEKDAYS.indexOf(get("weekday"))),
  };
}

/**
 * A zone that `Intl` will accept, or UTC.
 *
 * A shop row can hold a timezone that was valid when it was typed and has
 * since been removed from the database, and `Intl` throws a `RangeError` on
 * one. A throw here would take down the whole tick — every seller's flows —
 * over one seller's stale column, so it degrades to UTC and the send happens
 * at a defensible time rather than not at all.
 */
export function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * The UTC instant at which a zone's wall clock reads this local date and time.
 *
 * The inverse of `localParts`, and the primitive both wall-clock modes are
 * built on. Solved rather than searched: guess that the local time *is* UTC,
 * measure how far the zone actually was from UTC at that guess, subtract, and
 * measure once more — the second pass is what gets a transition right, because
 * the offset that applies is the one at the answer, not the one at the guess.
 *
 * On a spring-forward gap the requested wall clock never happens. The two
 * passes land just after the gap, which is the only defensible answer: the
 * alternative is a timer that never fires on the one day a year the hour it
 * names does not exist.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);

  const offsetAt = (instant: number): number => {
    const p = localParts(new Date(instant), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - instant;
  };

  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
}

/** The local calendar date `days` after the one `at` falls on. */
function localDatePlus(at: Date, timeZone: string, days: number) {
  const { year, month, day } = localParts(at, timeZone);
  /*
   * Calendar arithmetic, deliberately in UTC and deliberately not on the
   * instant. A local date always advances by exactly one day; it is only the
   * *duration* between two local midnights that DST changes, and nothing here
   * needs that duration.
   */
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * The next instant strictly after `from` whose local time is `hour:minute`.
 *
 * Candidate local dates rather than added durations. Adding 24 hours drifts an
 * hour twice a year and stays drifted; adding the *local* gap as if it were a
 * UTC duration overshoots the target on a spring-forward day and lands a day
 * late, which is the bug this shape exists to avoid. Asking "what instant is
 * 09:30 local on each of the next few days, and which is the first one still
 * ahead of us" has neither failure.
 */
function nextLocalTime(
  from: Date,
  timeZone: string,
  hour: number,
  minute: number,
): Date {
  for (let offset = 0; offset <= 2; offset += 1) {
    const { year, month, day } = localDatePlus(from, timeZone, offset);
    const candidate = zonedTimeToUtc(year, month, day, hour, minute, timeZone);
    // Strictly after: a timer set to exactly now must not resolve to now, wake
    // its run immediately and fire again.
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  // Unreachable for any real zone — three local days always contain the next
  // occurrence of a daily time. Returning something in the future rather than
  // looping is the safe end of that.
  return new Date(from.getTime() + DAY_MS);
}

/**
 * The next instant strictly after `from` that is `weekday` at `hour:minute`
 * locally.
 *
 * The same candidate walk, over eight local days rather than three — seven
 * covers every weekday and the eighth covers "today, but the time has passed".
 */
function nextLocalWeekday(
  from: Date,
  timeZone: string,
  weekday: number,
  hour: number,
  minute: number,
): Date {
  for (let offset = 0; offset <= 8; offset += 1) {
    const date = localDatePlus(from, timeZone, offset);
    if (date.weekday !== weekday) continue;
    const candidate = zonedTimeToUtc(
      date.year,
      date.month,
      date.day,
      hour,
      minute,
      timeZone,
    );
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  return new Date(from.getTime() + 7 * DAY_MS);
}

/**
 * When this timer's run should wake.
 *
 * `at` is the one mode that can already be in the past — a seller sets an
 * absolute date, and contacts keep entering the flow after it. That resolves
 * to `now`, so the run continues immediately rather than waiting for a moment
 * that will never come again. Every other mode is relative to `now` and cannot
 * be in the past.
 */
export function wakeAtFor(
  node: TimerNode,
  timeZone: string | null | undefined,
  now: Date,
): Date {
  const zone = safeZone(timeZone);

  switch (node.mode) {
    case "duration":
      // A duration is elapsed time, not wall-clock time: "wait two days" means
      // 48 hours whatever the calendar did in between, which is what a seller
      // means by it and what makes it independent of the zone.
      return new Date(now.getTime() + node.minutes * 60_000);

    case "at": {
      const when = new Date(node.at);
      return when.getTime() > now.getTime() ? when : now;
    }

    case "timeOfDay":
      return nextLocalTime(now, zone, node.hour, node.minute);

    case "dayOfWeek":
      return nextLocalWeekday(now, zone, node.weekday, node.hour, node.minute);
  }
}
