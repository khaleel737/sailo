import {
  addDays,
  zonedTimeToInstant,
  type CalendarDate,
  type WallTime,
} from "./time-zone";
import type { Busy } from "./slots";

/**
 * Reading a seller's other calendar.
 *
 * Sailo's exclusion constraint makes a Sailo double-booking impossible and
 * does nothing about the funeral already in the seller's own calendar — which
 * is the double booking that actually happens to people. This turns the
 * read-only feed Google, Apple and Outlook each publish into the same `Busy`
 * ranges a Sailo appointment produces, so the slot generator subtracts both
 * without knowing which is which.
 *
 * Pure, and given the clock and the window it should answer for. Nothing here
 * fetches anything — `external-busy.ts` does that — so every rule below is
 * testable at the boundary where it bites: the recurring meeting on the week
 * the clocks change, the all-day event, the invitation that was declined.
 *
 * Only what makes a time unbookable is read. Titles, attendees, descriptions
 * and locations are deliberately never parsed and never stored: Sailo needs
 * to know that Tuesday at three is taken, and has no business knowing who
 * with.
 */

/** How many occurrences one recurrence rule may produce before we stop. */
const MAX_OCCURRENCES = 10_000;

/** How many events one feed may contribute. A calendar, not a database. */
const MAX_EVENTS = 5_000;

/* -------------------------------------------------------------------------- */
/*  Lines and properties                                                       */
/* -------------------------------------------------------------------------- */

type Property = {
  name: string;
  params: Record<string, string>;
  value: string;
};

/**
 * Undoes RFC 5545 line folding.
 *
 * A long property is split across lines with each continuation beginning with
 * a space or a tab, and that is not cosmetic: a `RRULE` for a weekly meeting
 * routinely exceeds the 75-octet limit, so a parser that reads lines as
 * written sees half a rule and expands nothing. Accepts CRLF, LF and CR
 * because plenty of feeds are re-served by something that normalised them.
 */
export function unfold(ics: string): string[] {
  const lines = ics.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];

  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }

  return out.filter((line) => line.trim() !== "");
}

/**
 * `DTSTART;TZID=Europe/Berlin:20260810T090000` → name, params, value.
 *
 * The split is on the first colon *outside* a quoted parameter, because
 * `TZID="America/New York"` is legal and a naive `indexOf(":")` would cut a
 * zone in half — and a zone read wrong is an hour of the seller's day
 * misplaced rather than an error anyone sees.
 */
export function parseProperty(line: string): Property | null {
  let quoted = false;
  let colon = -1;

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const segments: string[] = [];
  let current = "";
  quoted = false;
  for (const c of head) {
    if (c === '"') quoted = !quoted;
    if (c === ";" && !quoted) {
      segments.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  segments.push(current);

  const name = (segments.shift() ?? "").trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const segment of segments) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    params[segment.slice(0, eq).trim().toUpperCase()] = segment
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, "");
  }

  return { name, params, value: value.trim() };
}

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
type ZonedStamp = {
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
function zoneFor(property: Property, defaultZone: string): string {
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
function instantOf(stamp: ZonedStamp): Date | null {
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

/* -------------------------------------------------------------------------- */
/*  Recurrence                                                                 */
/* -------------------------------------------------------------------------- */

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

type Recurrence = {
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
function nthWeekdayOf(
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
function* recurringDates(
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
function isBefore(a: CalendarDate, b: CalendarDate): boolean {
  return (
    Date.UTC(a.year, a.month - 1, a.day) < Date.UTC(b.year, b.month - 1, b.day)
  );
}

/* -------------------------------------------------------------------------- */
/*  Events                                                                     */
/* -------------------------------------------------------------------------- */

type RawEvent = {
  uid: string | null;
  /**
   * The properties as written, not stamps.
   *
   * The zone a stamp means depends on the shop's own, which this pass does
   * not have — resolving it here would have meant reading the file twice or
   * threading the shop through the tokeniser. Kept raw, parsed once in
   * `busyFromFeed`.
   */
  startProperty: Property | null;
  endProperty: Property | null;
  duration: number | null;
  rrule: string | null;
  exDates: string[];
  /** Set on the one modified instance of a recurring series. */
  recurrenceId: string | null;
  status: string | null;
  transparent: boolean;
  /** The seller's own answer on an invitation they were sent. */
  declined: boolean;
};

function collectEvents(lines: string[]): RawEvent[] {
  const events: RawEvent[] = [];
  let current: RawEvent | null = null;

  for (const line of lines) {
    const upper = line.toUpperCase();

    if (upper.startsWith("BEGIN:VEVENT")) {
      current = {
        uid: null,
        startProperty: null,
        endProperty: null,
        duration: null,
        rrule: null,
        exDates: [],
        recurrenceId: null,
        status: null,
        transparent: false,
        declined: false,
      };
      continue;
    }

    if (upper.startsWith("END:VEVENT")) {
      if (current && events.length < MAX_EVENTS) events.push(current);
      current = null;
      continue;
    }

    if (!current) continue;

    const property = parseProperty(line);
    if (!property) continue;

    switch (property.name) {
      case "UID":
        current.uid = property.value;
        break;
      case "DTSTART":
        current.startProperty = property;
        break;
      case "DTEND":
        current.endProperty = property;
        break;
      case "DURATION":
        current.duration = parseDuration(property.value);
        break;
      case "RRULE":
        current.rrule = property.value;
        break;
      case "EXDATE":
        current.exDates.push(...property.value.split(","));
        break;
      case "RECURRENCE-ID":
        current.recurrenceId = property.value;
        break;
      case "STATUS":
        current.status = property.value.toUpperCase();
        break;
      case "TRANSP":
        current.transparent = property.value.toUpperCase() === "TRANSPARENT";
        break;
      case "ATTENDEE":
        /*
         * An invitation the seller declined is not a commitment, and a
         * calendar full of declined invitations is exactly what an busy-time
         * reader must not treat as a full calendar. `PARTSTAT` on any
         * attendee line is enough here: this feed is one person's calendar,
         * so the only attendee whose answer it carries is theirs.
         */
        if (property.params.PARTSTAT?.toUpperCase() === "DECLINED") {
          current.declined = true;
        }
        break;
      default:
        break;
    }
  }

  return events;
}

/* -------------------------------------------------------------------------- */
/*  The one entry point                                                        */
/* -------------------------------------------------------------------------- */

export type FeedWindow = { from: Date; to: Date };

/**
 * Every busy range a feed declares inside a window.
 *
 * `defaultZone` is the shop's own, used for floating times and for the
 * Windows zone names Outlook still emits. Overlapping ranges are returned as
 * they are: the slot generator asks "does this candidate overlap anything",
 * so merging them would be work with no effect on the answer.
 */
export function busyFromFeed(
  ics: string,
  window: FeedWindow,
  defaultZone: string,
): Busy[] {
  if (!ics.includes("BEGIN:VEVENT")) return [];

  const events = collectEvents(unfold(ics));

  /*
   * A modified instance of a series carries `RECURRENCE-ID` naming the
   * original start it replaces. Collected first so the series expansion can
   * drop that instance — otherwise the seller's meeting that moved to
   * Thursday blocks Wednesday as well.
   */
  const overridden = new Map<string, Set<string>>();
  for (const event of events) {
    if (!event.recurrenceId || !event.uid) continue;
    const set = overridden.get(event.uid) ?? new Set<string>();
    set.add(normalizeStampKey(event.recurrenceId));
    overridden.set(event.uid, set);
  }

  const busy: Busy[] = [];

  for (const event of events) {
    if (event.status === "CANCELLED") continue;
    // TRANSPARENT is the property whose entire purpose is "this does not make
    // me busy" — a birthday, a reminder, a public holiday feed.
    if (event.transparent) continue;
    if (event.declined) continue;

    const startProperty = event.startProperty;
    if (!startProperty) continue;

    const start = parseStamp(startProperty, defaultZone);
    if (!start) continue;

    const startAt = instantOf(start);
    if (!startAt) continue;

    const durationMs = eventDuration(event, start, startAt, defaultZone);
    // A zero-length event marks a moment, not a period, and overlap here is
    // strict — so it can never block a slot and there is nothing to add.
    if (durationMs <= 0) continue;

    if (!event.rrule || event.recurrenceId) {
      pushIfInWindow(busy, startAt, durationMs, window);
      continue;
    }

    const rule = parseRecurrence(event.rrule, start.zone);
    if (!rule) {
      pushIfInWindow(busy, startAt, durationMs, window);
      continue;
    }

    const excluded = new Set(event.exDates.map(normalizeStampKey));
    const overrides = event.uid ? overridden.get(event.uid) : undefined;

    let taken = 0;
    for (const date of recurringDates(start.date, rule)) {
      if (rule.count !== null && taken >= rule.count) break;
      taken += 1;

      const at = zonedTimeToInstant(date, start.time, start.zone);
      // The wall time the clocks deleted. There is no such instant, so the
      // series simply has no instance that day.
      if (!at) continue;
      if (rule.until && at > rule.until) break;
      if (at.getTime() > window.to.getTime()) break;

      const key = stampKeyOf(date, start.time, start.allDay);
      if (excluded.has(key) || overrides?.has(key)) continue;

      pushIfInWindow(busy, at, durationMs, window);
    }
  }

  return busy;
}

/**
 * How long the event lasts, in milliseconds.
 *
 * `DTEND` when it has one, `DURATION` when it has that instead, and a whole
 * day for an all-day event with neither — which is the case that matters,
 * because an all-day "Annual leave" with no DTEND is how most calendars
 * write a day off and reading it as zero-length would leave the seller
 * bookable through it.
 */
function eventDuration(
  event: RawEvent,
  start: ZonedStamp,
  startAt: Date,
  defaultZone: string,
): number {
  if (event.endProperty) {
    const end = parseStamp(event.endProperty, defaultZone);
    const endAt = end ? instantOf(end) : null;
    if (endAt) return endAt.getTime() - startAt.getTime();
  }

  if (event.duration !== null) return event.duration;

  if (start.allDay) {
    // A calendar day, not 24 hours: on a clock-change day one of them is 23
    // hours long and the other 25, and the event covers the day either way.
    const next = zonedTimeToInstant(
      addDays(start.date, 1),
      { hour: 0, minute: 0 },
      start.zone,
    );
    if (next) return next.getTime() - startAt.getTime();
    return 86_400_000;
  }

  return 0;
}

function pushIfInWindow(
  busy: Busy[],
  startsAt: Date,
  durationMs: number,
  window: FeedWindow,
) {
  const endsAt = new Date(startsAt.getTime() + durationMs);
  // Half-open on both sides, matching `overlaps`: an event ending exactly
  // when the window opens is not in it.
  if (endsAt <= window.from || startsAt >= window.to) return;
  busy.push({ startsAt, endsAt });
}

/** `EXDATE` and `RECURRENCE-ID` are matched on their literal stamp. */
function normalizeStampKey(raw: string): string {
  const value = raw.includes(":") ? (raw.split(":").pop() ?? raw) : raw;
  return value.trim().replace(/Z$/, "").toUpperCase();
}

function stampKeyOf(date: CalendarDate, time: WallTime, allDay: boolean): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.year}${pad(date.month)}${pad(date.day)}`;
  return allDay ? day : `${day}T${pad(time.hour)}${pad(time.minute)}00`;
}
