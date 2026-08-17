/**
 * RRULE: the part of the format that generates rather than describes.
 *
 * Every other section reads what is written. This one expands one line into a series, which
 * is why the occurrence ceiling matters and why it is worth having on its own: `FREQ=MINUTELY`
 * with no `UNTIL` is a valid recurrence rule and an unbounded loop.
 */

import { addDays, type CalendarDate } from "./time-zone";
import { MAX_OCCURRENCES } from "./ics-lex";
import { instantOf, parseStamp } from "./ics-time";

/* -------------------------------------------------------------------------- */
/*  Recurrence                                                                 */
/* -------------------------------------------------------------------------- */

export const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export type Recurrence = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: Date | null;
  /** Weekday numbers (0 = Sunday) for WEEKLY, and for MONTHLY with `bySetPos`. */
  byDay: number[];
  /** The `3` in `BYDAY=3TH` — the third Thursday of the month. */
  ordinal: number | null;
  /** Which weekday a week starts on, 0 = Sunday. RFC 5545 defaults to Monday. */
  weekStart: number;
};

export function parseRecurrence(
  value: string,
  defaultZone: string,
): Recurrence | null {
  const parts = new Map<string, string>();
  for (const chunk of value.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq > 0) {
      parts.set(chunk.slice(0, eq).trim().toUpperCase(), chunk.slice(eq + 1).trim());
    }
  }

  const freq = parts.get("FREQ")?.toUpperCase();
  if (
    freq !== "DAILY" &&
    freq !== "WEEKLY" &&
    freq !== "MONTHLY" &&
    freq !== "YEARLY"
  ) {
    // HOURLY, MINUTELY and SECONDLY exist in the spec and in nobody's
    // calendar. Refusing the rule leaves the single DTSTART instance, which
    // blocks less than the truth rather than more.
    return null;
  }

  const interval = Math.max(1, Number(parts.get("INTERVAL") ?? 1) || 1);
  const rawCount = Number(parts.get("COUNT"));
  const count = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : null;

  let until: Date | null = null;
  const untilRaw = parts.get("UNTIL");
  if (untilRaw) {
    const stamp = parseStamp(
      { name: "UNTIL", params: {}, value: untilRaw },
      untilRaw.endsWith("Z") ? "UTC" : defaultZone,
    );
    // An all-day UNTIL bounds the whole of that day, not its first instant.
    const at = stamp ? instantOf(stamp) : null;
    until = at && stamp?.allDay ? new Date(at.getTime() + 86_400_000) : at;
  }

  const byDay: number[] = [];
  let ordinal: number | null = null;
  for (const token of (parts.get("BYDAY") ?? "").split(",")) {
    const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token.trim().toUpperCase());
    if (!m) continue;
    if (m[1]) ordinal = Number(m[1]);
    byDay.push(WEEKDAY_CODES.indexOf(m[2] as (typeof WEEKDAY_CODES)[number]));
  }

  const wkst = WEEKDAY_CODES.indexOf(
    (parts.get("WKST") ?? "MO").toUpperCase() as (typeof WEEKDAY_CODES)[number],
  );

  return {
    freq,
    interval,
    count,
    until,
    byDay,
    ordinal,
    weekStart: wkst === -1 ? 1 : wkst,
  };
}

/** The calendar date of the `ordinal`th `weekday` of a month. */
export function nthWeekdayOf(
  year: number,
  month: number,
  weekday: number,
  ordinal: number,
): CalendarDate | null {
  if (ordinal === 0) return null;

  if (ordinal > 0) {
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - firstWeekday + 7) % 7) + (ordinal - 1) * 7;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= lastDay ? { year, month, day } : null;
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWeekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  const day = lastDay - ((lastWeekday - weekday + 7) % 7) + (ordinal + 1) * 7;
  return day >= 1 ? { year, month, day } : null;
}

/**
 * The dates a rule fires on, walked forward from its start.
 *
 * Dates and not instants: the time of day never changes across a recurrence,
 * so the wall clock is carried from `DTSTART` and only the calendar date
 * moves. That is what keeps a 09:00 meeting at 09:00 through a clock change.
 *
 * Bounded twice — by `MAX_OCCURRENCES` and by the end of the window — because
 * this reads a document a third party serves and a rule with no COUNT and no
 * UNTIL is an infinite one by definition.
 */
export function* recurringDates(
  start: CalendarDate,
  rule: Recurrence,
): Generator<CalendarDate> {
  let emitted = 0;
  let step = 0;

  /*
   * Which day the week begins on, for the WEEKLY branch. Monday is the
   * default RFC 5545 gives `WKST`, and it is load-bearing rather than
   * cosmetic: `BYDAY=MO,WE` starting on a Wednesday means "this Wednesday,
   * then Monday and Wednesday of every following week", and getting the week
   * boundary wrong pushes every Monday seven days late — which unblocks a
   * morning the seller is actually in a meeting.
   */
  const startWeekday = new Date(
    Date.UTC(start.year, start.month - 1, start.day),
  ).getUTCDay();
  const weekStart = addDays(start, -((startWeekday - rule.weekStart + 7) % 7));

  while (step < MAX_OCCURRENCES && emitted < MAX_OCCURRENCES) {
    if (rule.freq === "DAILY") {
      emitted += 1;
      yield addDays(start, step * rule.interval);
    } else if (rule.freq === "WEEKLY") {
      const base = addDays(weekStart, step * rule.interval * 7);
      // No BYDAY means "the weekday DTSTART falls on".
      const days = rule.byDay.length > 0 ? rule.byDay : [startWeekday];
      const offsets = days
        .map((weekday) => (weekday - rule.weekStart + 7) % 7)
        .toSorted((a, b) => a - b);

      for (const offset of offsets) {
        const date = addDays(base, offset);
        // The rule cannot fire before it began: a BYDAY earlier in the week
        // than DTSTART has no instance in DTSTART's own week.
        if (isBefore(date, start)) continue;
        emitted += 1;
        yield date;
      }
    } else {
      const months = rule.freq === "MONTHLY" ? rule.interval : rule.interval * 12;
      const moved = new Date(
        Date.UTC(start.year, start.month - 1 + step * months, 1),
      );
      const year = moved.getUTCFullYear();
      const month = moved.getUTCMonth() + 1;

      if (rule.ordinal !== null && rule.byDay.length > 0) {
        const date = nthWeekdayOf(year, month, rule.byDay[0] ?? 0, rule.ordinal);
        if (date) {
          emitted += 1;
          yield date;
        }
      } else {
        // The same day number, skipping months that are too short — the 31st
        // does not become the 1st of the following month.
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        if (start.day <= lastDay) {
          emitted += 1;
          yield { year, month, day: start.day };
        }
      }
    }

    step += 1;
  }
}

/** Calendar-date ordering, with no instant and no zone in the way. */
export function isBefore(a: CalendarDate, b: CalendarDate): boolean {
  return (
    Date.UTC(a.year, a.month - 1, a.day) < Date.UTC(b.year, b.month - 1, b.day)
  );
}
