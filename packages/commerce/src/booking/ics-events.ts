/**
 * Events, and the busy intervals a shop's calendar actually contributes.
 *
 * The layer that knows what the parsed pieces are *for*: which events count as busy, what a
 * cancelled or transparent event means, and how a recurrence becomes intervals the booking
 * checker can compare against.
 */

import { addDays, zonedTimeToInstant, type CalendarDate, type WallTime } from "./time-zone";
import type { Busy } from "./slots";
import { MAX_EVENTS, parseProperty, type Property, unfold } from "./ics-lex";
import { instantOf, parseDuration, parseStamp, type ZonedStamp } from "./ics-time";
import { parseRecurrence, recurringDates } from "./ics-recurrence";

/* -------------------------------------------------------------------------- */
/*  Events                                                                     */
/* -------------------------------------------------------------------------- */

export type RawEvent = {
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
