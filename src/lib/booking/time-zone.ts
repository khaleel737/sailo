/**
 * Wall-clock time in a shop's own zone, and the instants it maps to.
 *
 * A booking is agreed in the seller's local time — "Tuesday at nine" — but
 * stored as an instant, because two people in different places must mean the
 * same moment. Converting between the two is the whole of this file, and it is
 * separate from everything else because it is where the errors hide: an hour
 * lost twice a year, a slot that exists on the calendar and not in reality.
 *
 * No dependency. `Intl.DateTimeFormat` already knows every IANA zone and the
 * rules for each, including historical ones, and it ships with the runtime.
 */

/** A time on a clock face. No date, no zone — those come from the caller. */
export type WallTime = { hour: number; minute: number };

/** A date on a calendar in some zone, with no time attached. */
export type CalendarDate = { year: number; month: number; day: number };

const PARTS = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let cached = PARTS.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PARTS.set(timeZone, cached);
  }
  return cached;
}

/** Whether the runtime recognises a zone, so a bad one fails at the edge. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    // Constructing is the check: an unknown zone throws a RangeError here.
    partsFormatter(value);
    return true;
  } catch {
    return false;
  }
}

/** A stored zone, or UTC when it is not one this runtime knows. */
export function zoneOf(stored: unknown): string {
  return isTimeZone(stored) ? stored : "UTC";
}

/** The wall clock in `timeZone` at a given instant. */
export function zonedParts(
  instant: Date,
  timeZone: string,
): CalendarDate & WallTime & { weekday: number } {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);

  /*
   * `hour` comes back as 24 rather than 0 for midnight under `hour12: false`
   * in some runtimes — a documented quirk rather than a bug in the data.
   */
  const hour = get("hour") % 24;
  const year = get("year");
  const month = get("month");
  const day = get("day");

  return {
    year,
    month,
    day,
    hour,
    minute: get("minute"),
    // Derived from the zoned Y-M-D rather than from the instant, so a shop
    // just past midnight is not still on yesterday's opening hours.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** How far `timeZone` is from UTC at a given instant, in minutes. */
export function offsetMinutesAt(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // Seconds and below are irrelevant to an offset and would only add noise.
  const floored = Math.floor(instant.getTime() / 60_000) * 60_000;
  return (asUtc - floored) / 60_000;
}

/**
 * The instant at which a given wall time occurs in a zone.
 *
 * Two passes, and the second is not optional. The first guess treats the wall
 * time as if it were UTC and asks what the offset is *there*; but the offset
 * may differ at the corrected instant — which is exactly what happens on the
 * days a zone changes — so the corrected instant is measured again and used.
 *
 * Returns null for a wall time that does not exist. On a spring-forward
 * morning the clock jumps 01:00 → 02:00, and 01:30 is not a moment anyone can
 * book. Answering with the nearest real instant would silently move an
 * appointment; answering with nothing lets the caller drop the slot.
 */
export function zonedTimeToInstant(
  date: CalendarDate,
  time: WallTime,
  timeZone: string,
): Date | null {
  const naive = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);

  const firstOffset = offsetMinutesAt(new Date(naive), timeZone);
  const corrected = naive - firstOffset * 60_000;
  const secondOffset = offsetMinutesAt(new Date(corrected), timeZone);
  const instant = new Date(naive - secondOffset * 60_000);

  /*
   * Round-trip check. If reading the clock back at this instant does not give
   * the wall time we asked for, that wall time did not occur — the zone
   * skipped it. Ambiguous times (the repeated hour in autumn) do round-trip,
   * and resolve to the first of the two, which is the earlier and the one a
   * calendar shows.
   */
  const back = zonedParts(instant, timeZone);
  const matches =
    back.year === date.year &&
    back.month === date.month &&
    back.day === date.day &&
    back.hour === time.hour &&
    back.minute === time.minute;

  return matches ? instant : null;
}

/** The calendar date `days` after one, in the zone's own reckoning. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  };
}

/** `2026-08-07`, the form a date input and a URL both accept. */
export function toIsoDate(date: CalendarDate): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** Reads `2026-08-07`, rejecting anything that is not a real calendar date. */
export function fromIsoDate(value: string): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  // Rejects 2026-02-31 rather than rolling it into March.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}
