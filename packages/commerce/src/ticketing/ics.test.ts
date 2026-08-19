import { describe, expect, it } from "vitest";
import { buildIcs, icsFilename, icsUid, offsetMinutes } from "./ics";

/**
 * The calendar entry, and the three properties that make it work — spec 50.
 *
 * A `.ics` that merely parses is easy. The ones that matter here are the ones
 * that decide whether a rescheduled event *moves* in somebody's diary or
 * quietly sits at the old time, and a test that only checked for `BEGIN:VEVENT`
 * would pass through every one of those failures.
 */

const STAMP = new Date("2026-08-11T12:00:00Z");
const START = new Date("2026-09-01T15:00:00Z");
const END = new Date("2026-09-01T17:00:00Z");

const base = {
  uid: icsUid("order-1", "session-1"),
  sequence: 0,
  startsAt: START,
  endsAt: END,
  summary: "Rooftop Show",
  stamp: STAMP,
};

const lines = (ics: string) => ics.split("\r\n");

/**
 * One property of the VEVENT.
 *
 * Scoped past `BEGIN:VEVENT` deliberately: a `VTIMEZONE` carries its own
 * `DTSTART`, and a helper that took the first match in the file would read the
 * timezone component's epoch and report the event as happening in 1970. The
 * first version of this helper did exactly that.
 */
const value = (ics: string, key: string) => {
  const all = lines(ics);
  const from = all.indexOf("BEGIN:VEVENT");
  const scope = from === -1 ? all : all.slice(from);
  return scope.find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1);
};

/** A calendar-level property, which sits above the VEVENT rather than in it. */
const header = (ics: string, key: string) =>
  lines(ics).find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1);

describe("the file itself", () => {
  it("is CRLF-terminated, as every client's parser expects", () => {
    const ics = buildIcs(base);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it("opens and closes the calendar and the event", () => {
    const ics = lines(buildIcs(base));
    expect(ics[0]).toBe("BEGIN:VCALENDAR");
    expect(ics.at(-2)).toBe("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
  });

  /*
   * `PUBLISH`, not `REQUEST`. A ticket is not a meeting invitation: nobody is
   * being asked whether they will come, they have paid — and `REQUEST` would
   * put RSVPs in the seller's inbox and tracking in their Outlook calendar.
   */
  it("publishes rather than inviting", () => {
    expect(header(buildIcs(base), "METHOD")).toBe("PUBLISH");
  });

  it("writes times in UTC, which is the one form every client agrees about", () => {
    const ics = buildIcs(base);
    expect(value(ics, "DTSTART")).toBe("20260901T150000Z");
    expect(value(ics, "DTEND")).toBe("20260901T170000Z");
    expect(value(ics, "DTSTAMP")).toBe("20260811T120000Z");
  });

  /*
   * A `VEVENT` with no end is an all-day event in several clients, so an
   * evening show with no stated finish would block the attendee's whole
   * Saturday.
   */
  it("gives an event with no stated end an hour rather than a whole day", () => {
    const ics = buildIcs({ ...base, endsAt: null });
    expect(value(ics, "DURATION")).toBe("PT1H");
    expect(value(ics, "DTEND")).toBeUndefined();
  });

  it("ignores an end that is not after the start", () => {
    const ics = buildIcs({ ...base, endsAt: START });
    expect(value(ics, "DURATION")).toBe("PT1H");
  });
});

describe("the identifier a calendar keys on", () => {
  /*
   * The load-bearing one. A reissue — a resend, a transfer, a corrected time —
   * must update the entry the attendee already has rather than adding a second
   * one, and every client decides that by `UID` alone.
   */
  it("is stable for one order and session", () => {
    expect(icsUid("order-1", "session-1")).toBe(icsUid("order-1", "session-1"));
  });

  it("differs per session, so a conference pass is eight entries", () => {
    expect(icsUid("order-1", "day-1")).not.toBe(icsUid("order-1", "day-2"));
  });

  it("differs per order, so two buyers do not share an entry", () => {
    expect(icsUid("order-1", "session-1")).not.toBe(icsUid("order-2", "session-1"));
  });

  it("works for an event with no sessions at all", () => {
    expect(icsUid("order-1")).toBe("order-1@sailo.store");
    expect(icsUid("order-1", null)).toBe("order-1@sailo.store");
  });
});

describe("changing an event that is already in a diary", () => {
  /*
   * Without a bumped `SEQUENCE` a client is entitled to ignore the update, and
   * the rescheduled event sits at the old time — worse than never having sent
   * one, because the attendee trusts it.
   */
  it("increments the sequence so the update is honoured", () => {
    expect(value(buildIcs({ ...base, sequence: 0 }), "SEQUENCE")).toBe("0");
    expect(value(buildIcs({ ...base, sequence: 3 }), "SEQUENCE")).toBe("3");
  });

  it("cancels rather than merely stopping, so it leaves the diary", () => {
    const ics = buildIcs({ ...base, sequence: 1, cancelled: true });
    expect(value(ics, "STATUS")).toBe("CANCELLED");
    // Same UID, so the client can find what to remove.
    expect(value(ics, "UID")).toBe(base.uid);
  });

  it("is confirmed otherwise", () => {
    expect(value(buildIcs(base), "STATUS")).toBe("CONFIRMED");
  });
});

describe("the event's own zone", () => {
  /*
   * A seller in Dubai running a webinar for a London audience is the normal
   * case, which is why the zone is per event rather than per shop. The instants
   * stay UTC — that is what makes them right — and the `VTIMEZONE` is what lets
   * the entry say which clock the seller meant.
   */
  it("names the zone beside times that stay in UTC", () => {
    const ics = buildIcs({ ...base, timeZone: "Asia/Dubai" });
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:Asia/Dubai");
    expect(value(ics, "DTSTART")).toBe("20260901T150000Z");
    expect(header(ics, "X-WR-TIMEZONE")).toBe("Asia/Dubai");
  });

  it("carries the offset that applies at the event's own instant", () => {
    const ics = buildIcs({ ...base, timeZone: "Asia/Dubai" });
    expect(ics).toContain("TZOFFSETTO:+0400");
  });

  /*
   * DST. The same zone gives different offsets in January and July, and a file
   * that hard-coded one would put a summer event an hour out for everybody
   * reading it in that zone.
   */
  it("reads a different offset either side of a DST boundary", () => {
    const winter = new Date("2026-01-15T12:00:00Z");
    const summer = new Date("2026-07-15T12:00:00Z");
    expect(offsetMinutes("Europe/London", winter)).toBe(0);
    expect(offsetMinutes("Europe/London", summer)).toBe(60);

    const summerIcs = buildIcs({ ...base, startsAt: summer, endsAt: null, timeZone: "Europe/London" });
    expect(summerIcs).toContain("TZOFFSETTO:+0100");
  });

  it("falls back to plain UTC times when the runtime does not know the zone", () => {
    // Correct rather than merely safe: the instants are right and only the
    // label is missing, which is far better than refusing to produce a file.
    const ics = buildIcs({ ...base, timeZone: "Mars/Olympus" });
    expect(ics).not.toContain("BEGIN:VTIMEZONE");
    expect(value(ics, "DTSTART")).toBe("20260901T150000Z");
  });
});

describe("escaping", () => {
  it("escapes the four characters that would otherwise end a property", () => {
    const ics = buildIcs({
      ...base,
      summary: "Jazz; blues, and \\ folk",
      description: "Line one\nLine two",
    });
    expect(value(ics, "SUMMARY")).toBe("Jazz\\; blues\\, and \\\\ folk");
    // A raw newline would end the property and make the rest an unknown line.
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
  });

  it("folds a long line at 75 octets with a leading-space continuation", () => {
    const ics = buildIcs({ ...base, summary: "x".repeat(200) });
    for (const line of lines(ics)) {
      expect(Buffer.from(line, "utf8").length).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain("\r\n x");
  });

  /*
   * Folded in *bytes*, not characters. A description in Arabic or Japanese
   * folds at half as many characters, and folding by `length` produces lines
   * that look legal and are too long — which several clients truncate rather
   * than complain about.
   */
  it("never splits a multi-byte character while folding", () => {
    const ics = buildIcs({ ...base, summary: "ماذا يحدث هنا في هذا الحدث الطويل جدا".repeat(4) });
    for (const line of lines(ics)) {
      expect(Buffer.from(line, "utf8").length).toBeLessThanOrEqual(75);
      // A split character would come back as U+FFFD.
      expect(line).not.toContain("�");
    }
  });
});

describe("the filename", () => {
  it("is safe for a browser and a mail client alike", () => {
    expect(icsFilename("Rooftop Show — 1st Sept!")).toBe("rooftop-show-1st-sept.ics");
    expect(icsFilename("")).toBe("event.ics");
  });
});
