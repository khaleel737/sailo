/**
 * Stamps and durations, which are where a calendar file lies about time.
 *
 * `DTSTART;TZID=Europe/London:20260701T090000` is not the same instant as
 * `20260701T090000Z`, and a floating stamp with no zone at all means "whatever zone the
 * reader is in" — which for us is the shop's. Getting this wrong moves a seller's whole
 * day, so it is separated from the parsing that surrounds it.
 */

import { zonedTimeToInstant, type CalendarDate, type WallTime } from "./time-zone";
import type { Property } from "./ics-lex";

/* -------------------------------------------------------------------------- */
/*  Times                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A moment as the calendar states it: a wall clock in a named zone.
 *
 * Kept in this form rather than collapsed to an instant because a recurring
 * event recurs at the same *wall* time. A standup at 09:00 Berlin is 07:00
 * UTC in winter and 06:00 UTC in summer, so expanding a rule by adding
 * milliseconds moves every instance after the clocks change — which is the
 * classic double-booking bug this whole folder exists to avoid.
 */
export type ZonedStamp = {
  date: CalendarDate;
  time: WallTime;
  zone: string;
  /** True for a `VALUE=DATE` stamp — a whole day, with no clock on it. */
  allDay: boolean;
};

/**
 * Which zone a property means.
 *
 * A trailing `Z` is UTC. A `TZID` is whatever it names, when the runtime
 * recognises it. Everything else is "floating" — a wall time with no zone,
 * which RFC 5545 says is local to whoever is reading, and the reader here is
 * the shop. Falling back to UTC instead would silently shift a European
 * seller's whole calendar by an hour or two, in the safe-looking direction of
 * hiding the wrong slots.
 */
export function zoneFor(property: Property, defaultZone: string): string {
  if (property.value.endsWith("Z") && !property.params.TZID) return "UTC";
  const tzid = property.params.TZID;
  if (!tzid) return defaultZone;

  try {
    // Constructing is the check: an unknown zone throws a RangeError here.
    Intl.DateTimeFormat("en-US", { timeZone: tzid });
    return tzid;
  } catch {
    /*
     * Outlook still emits Windows zone names ("W. Europe Standard Time")
     * that no IANA database knows. The shop's own zone is a better guess
     * than UTC for a calendar the shop's owner keeps, and the settings card
     * says which zone the feed is being read in so a wrong guess is visible
     * rather than mysterious.
     */
    return defaultZone;
  }
}

/** `20260810`, `20260810T090000`, `20260810T070000Z`. */
export function parseStamp(
  property: Property,
  defaultZone: string,
): ZonedStamp | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?Z?$/.exec(
    property.value.trim(),
  );
  if (!m) return null;

  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const allDay = m[4] === undefined || property.params.VALUE === "DATE";

  return {
    date,
    time: allDay
      ? { hour: 0, minute: 0 }
      : { hour: Number(m[4]), minute: Number(m[5]) },
    zone: zoneFor(property, defaultZone),
    allDay,
  };
}

/**
 * The instant a stamp names, or null when the clock skipped that wall time.
 *
 * Null is not a failure to handle by guessing. On a spring-forward morning
 * 01:30 does not occur, so a recurring 01:30 meeting genuinely has no
 * instance that day, and inventing one would block a slot that is free.
 */
export function instantOf(stamp: ZonedStamp): Date | null {
  return zonedTimeToInstant(stamp.date, stamp.time, stamp.zone);
}

/** `PT1H30M`, `P1D`, `P2DT3H` → milliseconds. Negative durations are ignored. */
export function parseDuration(value: string): number | null {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!m || m.slice(1).every((part) => part === undefined)) return null;

  const n = (part: string | undefined) => (part === undefined ? 0 : Number(part));
  const [weeks, days, hours, minutes, seconds] = [
    n(m[1]),
    n(m[2]),
    n(m[3]),
    n(m[4]),
    n(m[5]),
  ];

  return (
    ((weeks * 7 + days) * 24 * 3_600 + hours * 3_600 + minutes * 60 + seconds) *
    1_000
  );
}
