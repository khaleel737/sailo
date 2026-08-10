import { describe, expect, it } from "vitest";
import {
  busyFromFeed,
  parseDuration,
  parseProperty,
  unfold,
} from "./calendar-feed";

/**
 * The seller's other calendar, read.
 *
 * Every case here is one a real feed produces, and most of them fail in the
 * same direction if they are got wrong: the range is missed, no slot is
 * hidden, and a buyer books an hour the seller is already in. That is the
 * silent failure, so the tests lean on the cases that produce it.
 */

/** Wraps events in the envelope every feed has, so the tests read as events. */
function feed(...events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

function event(...lines: string[]): string {
  return ["BEGIN:VEVENT", "UID:test@example.com", ...lines, "END:VEVENT"].join(
    "\r\n",
  );
}

const WINDOW = {
  from: new Date("2026-03-01T00:00:00Z"),
  to: new Date("2026-05-01T00:00:00Z"),
};

const iso = (busy: { startsAt: Date; endsAt: Date }[]) =>
  busy.map((b) => [b.startsAt.toISOString(), b.endsAt.toISOString()]);

const starts = (busy: { startsAt: Date }[]) =>
  busy.map((b) => b.startsAt.toISOString()).toSorted();

describe("unfolding", () => {
  it("rejoins a continuation line", () => {
    const lines = unfold("RRULE:FREQ=WEEKLY;\r\n BYDAY=MO,WE\r\nEND:VEVENT");
    expect(lines[0]).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,WE");
  });

  it("accepts a feed whose line endings were normalised in transit", () => {
    expect(unfold("A:1\nB:2")).toEqual(["A:1", "B:2"]);
    expect(unfold("A:1\rB:2")).toEqual(["A:1", "B:2"]);
  });
});

describe("properties", () => {
  it("splits on the colon outside a quoted parameter", () => {
    // A zone with a space in it is quoted, and a naive indexOf(":") would cut
    // "America/New York" in half — an hour of the seller's day, misplaced.
    const p = parseProperty('DTSTART;TZID="America/New York":20260310T090000');
    expect(p?.name).toBe("DTSTART");
    expect(p?.params.TZID).toBe("America/New York");
    expect(p?.value).toBe("20260310T090000");
  });

  it("reads a bare parameter list", () => {
    const p = parseProperty("DTSTART;VALUE=DATE:20260310");
    expect(p?.params.VALUE).toBe("DATE");
  });
});

describe("durations", () => {
  it("reads the forms a calendar writes", () => {
    expect(parseDuration("PT1H")).toBe(3_600_000);
    expect(parseDuration("PT1H30M")).toBe(5_400_000);
    expect(parseDuration("P1D")).toBe(86_400_000);
    expect(parseDuration("P1W")).toBe(7 * 86_400_000);
    expect(parseDuration("P2DT3H")).toBe(2 * 86_400_000 + 3 * 3_600_000);
  });

  it("refuses what it cannot read rather than guessing zero", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("1 hour")).toBeNull();
  });
});

describe("a single event", () => {
  it("reads a zoned start and end", () => {
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART;TZID=Europe/Berlin:20260310T090000",
          "DTEND;TZID=Europe/Berlin:20260310T100000",
        ),
      ),
      WINDOW,
      "UTC",
    );
    // Berlin is UTC+1 in March before the change.
    expect(iso(busy)).toEqual([
      ["2026-03-10T08:00:00.000Z", "2026-03-10T09:00:00.000Z"],
    ]);
  });

  it("reads a UTC start", () => {
    const busy = busyFromFeed(
      feed(event("DTSTART:20260310T090000Z", "DTEND:20260310T093000Z")),
      WINDOW,
      "Europe/Berlin",
    );
    expect(iso(busy)).toEqual([
      ["2026-03-10T09:00:00.000Z", "2026-03-10T09:30:00.000Z"],
    ]);
  });

  it("reads a floating time in the shop's own zone, not UTC", () => {
    // RFC 5545 says a stamp with no zone is local to the reader, and the
    // reader is the shop. Defaulting to UTC would shift a European seller's
    // whole calendar and hide the wrong hours.
    const busy = busyFromFeed(
      feed(event("DTSTART:20260310T090000", "DTEND:20260310T100000")),
      WINDOW,
      "Europe/Berlin",
    );
    expect(iso(busy)).toEqual([
      ["2026-03-10T08:00:00.000Z", "2026-03-10T09:00:00.000Z"],
    ]);
  });

  it("falls back to the shop's zone for a TZID no runtime knows", () => {
    // Outlook still emits Windows zone names.
    const busy = busyFromFeed(
      feed(
        event(
          'DTSTART;TZID="W. Europe Standard Time":20260310T090000',
          "DTEND;TZID=\"W. Europe Standard Time\":20260310T100000",
        ),
      ),
      WINDOW,
      "Europe/Berlin",
    );
    expect(iso(busy)).toEqual([
      ["2026-03-10T08:00:00.000Z", "2026-03-10T09:00:00.000Z"],
    ]);
  });

  it("takes DURATION when there is no DTEND", () => {
    const busy = busyFromFeed(
      feed(event("DTSTART:20260310T090000Z", "DURATION:PT90M")),
      WINDOW,
      "UTC",
    );
    expect(iso(busy)).toEqual([
      ["2026-03-10T09:00:00.000Z", "2026-03-10T10:30:00.000Z"],
    ]);
  });

  it("blocks the whole day for an all-day event with no end", () => {
    // "Annual leave" as most calendars write it. Reading it as zero-length
    // leaves the seller bookable straight through their day off.
    const busy = busyFromFeed(
      feed(event("DTSTART;VALUE=DATE:20260310")),
      WINDOW,
      "Europe/Berlin",
    );
    expect(iso(busy)).toEqual([
      ["2026-03-09T23:00:00.000Z", "2026-03-10T23:00:00.000Z"],
    ]);
  });

  it("treats an all-day DTEND as exclusive", () => {
    const busy = busyFromFeed(
      feed(event("DTSTART;VALUE=DATE:20260310", "DTEND;VALUE=DATE:20260312")),
      WINDOW,
      "UTC",
    );
    expect(iso(busy)).toEqual([
      ["2026-03-10T00:00:00.000Z", "2026-03-12T00:00:00.000Z"],
    ]);
  });

  it("covers a whole calendar day even when that day is 23 hours long", () => {
    // The Sunday the clocks go forward in Berlin is 23 hours, and an all-day
    // event on it ends at the next local midnight rather than 24 hours on.
    const busy = busyFromFeed(
      feed(event("DTSTART;VALUE=DATE:20260329")),
      { from: new Date("2026-03-01T00:00:00Z"), to: new Date("2026-04-01T00:00:00Z") },
      "Europe/Berlin",
    );
    expect(iso(busy)).toEqual([
      ["2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"],
    ]);
  });
});

describe("events that do not make anyone busy", () => {
  it("ignores a cancelled event", () => {
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART:20260310T090000Z",
          "DTEND:20260310T100000Z",
          "STATUS:CANCELLED",
        ),
      ),
      WINDOW,
      "UTC",
    );
    expect(busy).toEqual([]);
  });

  it("ignores a transparent event", () => {
    // TRANSP:TRANSPARENT is the property whose entire meaning is "this does
    // not make me busy" — birthdays, reminders, holiday feeds.
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART:20260310T090000Z",
          "DTEND:20260310T100000Z",
          "TRANSP:TRANSPARENT",
        ),
      ),
      WINDOW,
      "UTC",
    );
    expect(busy).toEqual([]);
  });

  it("ignores an invitation the seller declined", () => {
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART:20260310T090000Z",
          "DTEND:20260310T100000Z",
          "ATTENDEE;PARTSTAT=DECLINED;CN=Seller:mailto:seller@example.com",
        ),
      ),
      WINDOW,
      "UTC",
    );
    expect(busy).toEqual([]);
  });

  it("ignores a zero-length event", () => {
    const busy = busyFromFeed(
      feed(event("DTSTART:20260310T090000Z", "DTEND:20260310T090000Z")),
      WINDOW,
      "UTC",
    );
    expect(busy).toEqual([]);
  });

  it("returns nothing for junk and for an empty calendar", () => {
    expect(busyFromFeed("", WINDOW, "UTC")).toEqual([]);
    expect(busyFromFeed("<!doctype html><h1>Sign in</h1>", WINDOW, "UTC")).toEqual([]);
    expect(busyFromFeed(feed(), WINDOW, "UTC")).toEqual([]);
  });
});

describe("recurrence", () => {
  it("expands a weekly rule across the window", () => {
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART;TZID=Europe/Berlin:20260305T090000",
          "DTEND;TZID=Europe/Berlin:20260305T100000",
          "RRULE:FREQ=WEEKLY",
        ),
      ),
      {
        from: new Date("2026-03-01T00:00:00Z"),
        to: new Date("2026-03-26T00:00:00Z"),
      },
      "UTC",
    );
    expect(starts(busy)).toEqual([
      "2026-03-05T08:00:00.000Z",
      "2026-03-12T08:00:00.000Z",
      "2026-03-19T08:00:00.000Z",
    ]);
  });

  it("keeps a recurring meeting at its wall-clock time across a clock change", () => {
    /*
     * The bug this whole folder exists to avoid. A 09:00 Berlin standup is
     * 08:00 UTC in winter and 07:00 UTC in summer; expanding the rule by
     * adding seven days of milliseconds keeps it at 08:00 UTC forever, so
     * from the end of March every instance blocks the wrong hour — and the
     * hour it stops blocking is one the seller is in a meeting.
     */
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART;TZID=Europe/Berlin:20260326T090000",
          "DTEND;TZID=Europe/Berlin:20260326T100000",
          "RRULE:FREQ=WEEKLY;COUNT=3",
        ),
      ),
      {
        from: new Date("2026-03-01T00:00:00Z"),
        to: new Date("2026-04-30T00:00:00Z"),
      },
      "UTC",
    );
    expect(starts(busy)).toEqual([
      // Before the change: UTC+1.
      "2026-03-26T08:00:00.000Z",
      // After it: UTC+2, and still 09:00 on the seller's own clock.
      "2026-04-02T07:00:00.000Z",
      "2026-04-09T07:00:00.000Z",
    ]);
  });

  it("puts BYDAY days in the week they belong to", () => {
    /*
     * DTSTART is a Wednesday and the rule also fires on Monday. The Monday
     * that follows belongs to the *next* week, and an off-by-one week here
     * frees every Monday morning the seller is booked.
     */
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART:20260304T090000Z",
          "DTEND:20260304T100000Z",
          "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
        ),
      ),
      {
        from: new Date("2026-03-01T00:00:00Z"),
        to: new Date("2026-03-19T00:00:00Z"),
      },
      "UTC",
    );
    expect(starts(busy)).toEqual([
      "2026-03-04T09:00:00.000Z", // Wed — DTSTART
      "2026-03-09T09:00:00.000Z", // Mon
      "2026-03-11T09:00:00.000Z", // Wed
      "2026-03-16T09:00:00.000Z", // Mon
      "2026-03-18T09:00:00.000Z", // Wed
    ]);
  });

  it("honours INTERVAL", () => {
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART:20260302T090000Z",
          "DTEND:20260302T100000Z",
          "RRULE:FREQ=WEEKLY;INTERVAL=2",
        ),
      ),
      {
        from: new Date("2026-03-01T00:00:00Z"),
        to: new Date("2026-04-01T00:00:00Z"),
      },
      "UTC",
    );
    expect(starts(busy)).toEqual([
      "2026-03-02T09:00:00.000Z",
      "2026-03-16T09:00:00.000Z",
      "2026-03-30T09:00:00.000Z",
    ]);
  });

  it("stops at UNTIL", () => {
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART:20260302T090000Z",
          "DTEND:20260302T100000Z",
          "RRULE:FREQ=DAILY;UNTIL=20260304T235959Z",
        ),
      ),
      WINDOW,
      "UTC",
    );
    expect(starts(busy)).toEqual([
      "2026-03-02T09:00:00.000Z",
      "2026-03-03T09:00:00.000Z",
      "2026-03-04T09:00:00.000Z",
    ]);
  });

  it("drops an EXDATE from the series", () => {
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART:20260302T090000Z",
          "DTEND:20260302T100000Z",
          "RRULE:FREQ=DAILY;COUNT=3",
          "EXDATE:20260303T090000Z",
        ),
      ),
      WINDOW,
      "UTC",
    );
    expect(starts(busy)).toEqual([
      "2026-03-02T09:00:00.000Z",
      "2026-03-04T09:00:00.000Z",
    ]);
  });

  it("frees the original slot when one instance was moved", () => {
    /*
     * A RECURRENCE-ID event replaces one occurrence of its series. Adding it
     * without removing what it replaced blocks both — the seller's meeting
     * moved to Wednesday and Tuesday is still shut.
     */
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART:20260302T090000Z",
          "DTEND:20260302T100000Z",
          "RRULE:FREQ=DAILY;COUNT=3",
        ),
        [
          "BEGIN:VEVENT",
          "UID:test@example.com",
          "RECURRENCE-ID:20260303T090000Z",
          "DTSTART:20260303T140000Z",
          "DTEND:20260303T150000Z",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      WINDOW,
      "UTC",
    );
    expect(starts(busy)).toEqual([
      "2026-03-02T09:00:00.000Z",
      "2026-03-03T14:00:00.000Z", // moved to the afternoon
      "2026-03-04T09:00:00.000Z",
    ]);
  });

  it("expands the third Thursday of the month", () => {
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART:20260319T090000Z",
          "DTEND:20260319T100000Z",
          "RRULE:FREQ=MONTHLY;BYDAY=3TH",
        ),
      ),
      {
        from: new Date("2026-03-01T00:00:00Z"),
        to: new Date("2026-06-01T00:00:00Z"),
      },
      "UTC",
    );
    expect(starts(busy)).toEqual([
      "2026-03-19T09:00:00.000Z",
      "2026-04-16T09:00:00.000Z",
      "2026-05-21T09:00:00.000Z",
    ]);
  });

  it("skips months too short for a monthly day number", () => {
    // The 31st does not roll into the 1st of the next month.
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART:20260131T090000Z",
          "DTEND:20260131T100000Z",
          "RRULE:FREQ=MONTHLY",
        ),
      ),
      {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-05-01T00:00:00Z"),
      },
      "UTC",
    );
    expect(starts(busy)).toEqual([
      "2026-01-31T09:00:00.000Z",
      "2026-03-31T09:00:00.000Z",
      // No February, and no 31 April.
    ]);
  });

  it("has no instance on a day the clock skipped", () => {
    /*
     * Berlin jumps 02:00 → 03:00 on 29 March 2026, so a daily 02:30 meeting
     * genuinely does not happen that day. Inventing an instance would block
     * a slot that is free; the run simply has a gap.
     */
    const busy = busyFromFeed(
      feed(
        event(
          "DTSTART;TZID=Europe/Berlin:20260328T023000",
          "DTEND;TZID=Europe/Berlin:20260328T033000",
          "RRULE:FREQ=DAILY;COUNT=3",
        ),
      ),
      {
        from: new Date("2026-03-01T00:00:00Z"),
        to: new Date("2026-04-05T00:00:00Z"),
      },
      "Europe/Berlin",
    );
    expect(starts(busy)).toEqual([
      "2026-03-28T01:30:00.000Z",
      "2026-03-30T00:30:00.000Z",
    ]);
  });
});

describe("the window", () => {
  it("excludes an event that ends exactly as the window opens", () => {
    // Half-open, the same rule `overlaps` uses for a Sailo appointment.
    const busy = busyFromFeed(
      feed(event("DTSTART:20260228T230000Z", "DTEND:20260301T000000Z")),
      WINDOW,
      "UTC",
    );
    expect(busy).toEqual([]);
  });

  it("keeps an event that starts before the window and runs into it", () => {
    const busy = busyFromFeed(
      feed(event("DTSTART:20260228T230000Z", "DTEND:20260301T010000Z")),
      WINDOW,
      "UTC",
    );
    expect(iso(busy)).toEqual([
      ["2026-02-28T23:00:00.000Z", "2026-03-01T01:00:00.000Z"],
    ]);
  });

  it("excludes an event starting exactly as the window closes", () => {
    const busy = busyFromFeed(
      feed(event("DTSTART:20260501T000000Z", "DTEND:20260501T010000Z")),
      WINDOW,
      "UTC",
    );
    expect(busy).toEqual([]);
  });
});
