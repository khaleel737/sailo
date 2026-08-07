import { describe, expect, it } from "vitest";
import {
  addDays,
  fromIsoDate,
  isTimeZone,
  offsetMinutesAt,
  toIsoDate,
  zonedParts,
  zonedTimeToInstant,
} from "@/lib/booking/time-zone";

/**
 * The layer every booking rests on.
 *
 * A slot is agreed in the seller's local time and stored as an instant, so
 * every appointment in the product passes through these functions. The cases
 * that matter are the ones nobody hits while developing: the two days a year a
 * zone changes, and the zones that are not whole hours from UTC.
 */

describe("isTimeZone", () => {
  it.each(["UTC", "Europe/Lisbon", "America/New_York", "Asia/Kolkata", "Australia/Eucla"])(
    "accepts %s",
    (zone) => {
      expect(isTimeZone(zone)).toBe(true);
    },
  );

  it.each(["", "Mars/Olympus", "GMT+5", "not a zone", "Europe/Nowhere"])(
    "rejects %j",
    (zone) => {
      expect(isTimeZone(zone)).toBe(false);
    },
  );

  it.each([null, undefined, 0, {}])("rejects the non-string %j", (value) => {
    // It arrives from a seller's settings form, so its type is a claim.
    expect(isTimeZone(value)).toBe(false);
  });
});

describe("offsetMinutesAt", () => {
  it("is zero in UTC", () => {
    expect(offsetMinutesAt(new Date("2026-08-07T12:00:00Z"), "UTC")).toBe(0);
  });

  it("follows a zone across its own summer change", () => {
    // Lisbon is UTC+0 in winter and UTC+1 in summer.
    expect(offsetMinutesAt(new Date("2026-01-15T12:00:00Z"), "Europe/Lisbon")).toBe(0);
    expect(offsetMinutesAt(new Date("2026-08-15T12:00:00Z"), "Europe/Lisbon")).toBe(60);
  });

  it("handles a zone behind UTC", () => {
    // New York is UTC-5 in winter, UTC-4 on daylight time.
    expect(offsetMinutesAt(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe(-300);
    expect(offsetMinutesAt(new Date("2026-08-15T12:00:00Z"), "America/New_York")).toBe(-240);
  });

  it("handles zones that are not whole hours from UTC", () => {
    // The half-hour and quarter-hour zones are where naive maths breaks.
    expect(offsetMinutesAt(new Date("2026-08-15T12:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(offsetMinutesAt(new Date("2026-08-15T12:00:00Z"), "Asia/Kathmandu")).toBe(345);
    expect(offsetMinutesAt(new Date("2026-08-15T12:00:00Z"), "Australia/Eucla")).toBe(525);
  });
});

describe("zonedParts", () => {
  it("reads the clock face in the shop's zone, not the server's", () => {
    const p = zonedParts(new Date("2026-08-07T23:30:00Z"), "Asia/Kolkata");
    // 23:30 UTC is already the next morning in Kolkata.
    expect(p).toMatchObject({ year: 2026, month: 8, day: 8, hour: 5, minute: 0 });
  });

  it("reports midnight as hour 0, never 24", () => {
    // `hour12: false` yields "24" for midnight in some runtimes.
    const p = zonedParts(new Date("2026-08-07T00:00:00Z"), "UTC");
    expect(p.hour).toBe(0);
    expect(p.day).toBe(7);
  });

  it("takes the weekday from the zoned date, not the instant", () => {
    /*
     * 2026-08-07 is a Friday. At 23:30 UTC it is already Saturday in Kolkata,
     * and a shop closed on Saturdays must not be treated as open.
     */
    expect(zonedParts(new Date("2026-08-07T12:00:00Z"), "UTC").weekday).toBe(5);
    expect(zonedParts(new Date("2026-08-07T23:30:00Z"), "Asia/Kolkata").weekday).toBe(6);
  });
});

describe("zonedTimeToInstant", () => {
  it("maps a wall time to the instant it happens", () => {
    const instant = zonedTimeToInstant(
      { year: 2026, month: 8, day: 7 },
      { hour: 9, minute: 0 },
      "Europe/Lisbon",
    );
    // Lisbon is UTC+1 in August, so 09:00 local is 08:00Z.
    expect(instant?.toISOString()).toBe("2026-08-07T08:00:00.000Z");
  });

  it("uses the offset at the corrected instant, not the first guess", () => {
    /*
     * The reason the conversion is two passes. Reading the offset at the naive
     * UTC guess gives the wrong answer whenever the zone changes between that
     * guess and the real instant — which is what a single-pass conversion gets
     * wrong on exactly the days this test covers.
     */
    const winter = zonedTimeToInstant(
      { year: 2026, month: 1, day: 15 },
      { hour: 9, minute: 0 },
      "America/New_York",
    );
    expect(winter?.toISOString()).toBe("2026-01-15T14:00:00.000Z");

    const summer = zonedTimeToInstant(
      { year: 2026, month: 8, day: 15 },
      { hour: 9, minute: 0 },
      "America/New_York",
    );
    expect(summer?.toISOString()).toBe("2026-08-15T13:00:00.000Z");
  });

  it("handles a half-hour zone", () => {
    const instant = zonedTimeToInstant(
      { year: 2026, month: 8, day: 7 },
      { hour: 9, minute: 0 },
      "Asia/Kolkata",
    );
    expect(instant?.toISOString()).toBe("2026-08-07T03:30:00.000Z");
  });

  it("refuses a wall time the clock skipped", () => {
    /*
     * The most important case here. In 2026 the US springs forward on March 8:
     * 02:00 becomes 03:00, so 02:30 never happens. Offering it as a slot would
     * book an appointment at a moment that does not exist, and answering with
     * the nearest real instant would move it without telling anyone.
     */
    const skipped = zonedTimeToInstant(
      { year: 2026, month: 3, day: 8 },
      { hour: 2, minute: 30 },
      "America/New_York",
    );
    expect(skipped).toBeNull();
  });

  it("still accepts the hours either side of the gap", () => {
    for (const hour of [1, 3]) {
      expect(
        zonedTimeToInstant({ year: 2026, month: 3, day: 8 }, { hour, minute: 0 }, "America/New_York"),
      ).not.toBeNull();
    }
  });

  it("resolves a repeated hour to the first of the two", () => {
    /*
     * Autumn is the mirror case: on 2026-11-01 New York repeats 01:00–02:00,
     * so 01:30 happens twice. Both are real, so this must not return null —
     * it takes the earlier, which is the one a calendar shows.
     */
    const instant = zonedTimeToInstant(
      { year: 2026, month: 11, day: 1 },
      { hour: 1, minute: 30 },
      "America/New_York",
    );
    expect(instant?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("round-trips every whole hour of an ordinary day", () => {
    for (let hour = 0; hour < 24; hour++) {
      const instant = zonedTimeToInstant(
        { year: 2026, month: 8, day: 7 },
        { hour, minute: 0 },
        "Europe/Lisbon",
      );
      expect(instant, `hour ${hour}`).not.toBeNull();
      expect(zonedParts(instant as Date, "Europe/Lisbon").hour).toBe(hour);
    }
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays({ year: 2026, month: 8, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 9,
      day: 1,
    });
  });

  it("crosses a year boundary", () => {
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });

  it("knows February in a leap year", () => {
    expect(addDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
    expect(addDays({ year: 2026, month: 2, day: 28 }, 1)).toEqual({
      year: 2026,
      month: 3,
      day: 1,
    });
  });

  it("goes backwards too", () => {
    expect(addDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
  });
});

describe("toIsoDate and fromIsoDate", () => {
  it("round-trips", () => {
    const date = { year: 2026, month: 8, day: 7 };
    expect(toIsoDate(date)).toBe("2026-08-07");
    expect(fromIsoDate("2026-08-07")).toEqual(date);
  });

  it("pads single digits", () => {
    expect(toIsoDate({ year: 2026, month: 1, day: 2 })).toBe("2026-01-02");
  });

  it("rejects a date that does not exist rather than rolling it forward", () => {
    // `new Date(2026, 1, 31)` is March 3rd. A slot query must not silently
    // answer for a different day than the one asked for.
    expect(fromIsoDate("2026-02-31")).toBeNull();
    expect(fromIsoDate("2026-13-01")).toBeNull();
    expect(fromIsoDate("2026-00-10")).toBeNull();
  });

  it.each(["", "07/08/2026", "2026-8-7", "2026-08-07T00:00:00Z", "yesterday"])(
    "rejects the malformed %j",
    (value) => {
      expect(fromIsoDate(value)).toBeNull();
    },
  );

  it("accepts Feb 29 only in a leap year", () => {
    expect(fromIsoDate("2028-02-29")).not.toBeNull();
    expect(fromIsoDate("2026-02-29")).toBeNull();
  });
});
