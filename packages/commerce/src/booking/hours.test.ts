import { describe, expect, it } from "vitest";
import {
  clockTime,
  hoursOf,
  DEFAULT_WEEKLY_HOURS,
  isClosedAllWeek,
  isWeeklyHours,
  minutesOfDay,
  normalizeWeeklyHours,
} from "../booking/hours";

/**
 * The seller's own description of when they work.
 *
 * Stored as jsonb, so it comes back from the database as `unknown`: a row
 * written by an older build, or edited by hand, has to be refused rather than
 * fed to the slot generator, where a malformed window would either crash it or
 * silently offer nothing.
 */

describe("minutesOfDay", () => {
  it.each([
    ["00:00", 0],
    ["09:00", 540],
    ["09:30", 570],
    ["9:05", 545],
    ["23:59", 1439],
  ])("reads %j as %i", (value, minutes) => {
    expect(minutesOfDay(value)).toBe(minutes);
  });

  it("tolerates the spaces a form leaves behind", () => {
    expect(minutesOfDay("  09:00 ")).toBe(540);
  });

  it.each(["24:00", "23:60", "9", "0900", "9:5", "", "noon", "09:00:00"])(
    "refuses %j",
    (value) => {
      expect(minutesOfDay(value)).toBeNull();
    },
  );

  it.each([null, undefined, 540, {}])("refuses the non-string %j", (value) => {
    expect(minutesOfDay(value)).toBeNull();
  });
});

describe("clockTime", () => {
  it("round-trips with minutesOfDay", () => {
    for (const minutes of [0, 540, 570, 1439]) {
      expect(minutesOfDay(clockTime(minutes))).toBe(minutes);
    }
  });

  it("pads to two digits", () => {
    expect(clockTime(5)).toBe("00:05");
    expect(clockTime(540)).toBe("09:00");
  });

  it("clamps rather than producing a time that cannot exist", () => {
    expect(clockTime(-60)).toBe("00:00");
    expect(clockTime(99_999)).toBe("23:59");
  });
});

describe("isWeeklyHours", () => {
  it("accepts the default", () => {
    expect(isWeeklyHours(DEFAULT_WEEKLY_HOURS)).toBe(true);
  });

  it("accepts a week with every day closed", () => {
    expect(isWeeklyHours([[], [], [], [], [], [], []])).toBe(true);
  });

  const malformed: [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
    ["an empty array", []],
    ["six days", [[], [], [], [], [], []]],
    ["eight days", [[], [], [], [], [], [], [], []]],
  ];

  it.each(malformed)("refuses %s", (_label, value) => {
    expect(isWeeklyHours(value)).toBe(false);
  });

  it("refuses a window whose end is not after its start", () => {
    // A zero-length window would generate no slots and hide the mistake.
    const week = (w: unknown) => [[w], [], [], [], [], [], []];
    expect(isWeeklyHours(week({ from: "09:00", to: "09:00" }))).toBe(false);
    expect(isWeeklyHours(week({ from: "17:00", to: "09:00" }))).toBe(false);
  });

  it("refuses a window with an unreadable time", () => {
    const week = (w: unknown) => [[w], [], [], [], [], [], []];
    expect(isWeeklyHours(week({ from: "09:00", to: "25:00" }))).toBe(false);
    expect(isWeeklyHours(week({ from: "morning", to: "17:00" }))).toBe(false);
    expect(isWeeklyHours(week({ from: "09:00" }))).toBe(false);
  });
});

describe("normalizeWeeklyHours", () => {
  it("always returns seven days, whatever it was given", () => {
    for (const input of [null, undefined, {}, [], [[]]]) {
      expect(normalizeWeeklyHours(input)).toHaveLength(7);
    }
  });

  it("drops the windows it cannot read and keeps the rest", () => {
    const week = normalizeWeeklyHours([
      [
        { from: "09:00", to: "12:00" },
        { from: "bad", to: "17:00" },
        { from: "14:00", to: "13:00" },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(week[0]).toEqual([{ from: "09:00", to: "12:00" }]);
  });

  it("puts windows in order", () => {
    const week = normalizeWeeklyHours([
      [
        { from: "14:00", to: "17:00" },
        { from: "09:00", to: "12:00" },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(week[0]).toEqual([
      { from: "09:00", to: "12:00" },
      { from: "14:00", to: "17:00" },
    ]);
  });

  it("merges windows that overlap, so a slot is not offered twice", () => {
    const week = normalizeWeeklyHours([
      [
        { from: "09:00", to: "13:00" },
        { from: "11:00", to: "17:00" },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(week[0]).toEqual([{ from: "09:00", to: "17:00" }]);
  });

  it("merges windows that merely touch", () => {
    // 09:00–12:00 and 12:00–17:00 are one working day, and leaving them apart
    // would put a slot boundary at noon that the seller never asked for.
    const week = normalizeWeeklyHours([
      [
        { from: "09:00", to: "12:00" },
        { from: "12:00", to: "17:00" },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(week[0]).toEqual([{ from: "09:00", to: "17:00" }]);
  });

  it("leaves a real lunch break alone", () => {
    const week = normalizeWeeklyHours([
      [
        { from: "09:00", to: "12:00" },
        { from: "14:00", to: "17:00" },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(week[0]).toHaveLength(2);
  });

  it("swallows a window wholly inside another", () => {
    const week = normalizeWeeklyHours([
      [
        { from: "09:00", to: "17:00" },
        { from: "11:00", to: "12:00" },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(week[0]).toEqual([{ from: "09:00", to: "17:00" }]);
  });

  it("produces something isWeeklyHours accepts, whatever it was fed", () => {
    // The contract the database column relies on.
    for (const input of [null, "nonsense", [{ from: "x" }], DEFAULT_WEEKLY_HOURS]) {
      expect(isWeeklyHours(normalizeWeeklyHours(input))).toBe(true);
    }
  });
});

describe("isClosedAllWeek", () => {
  it("is true when nothing is open", () => {
    expect(isClosedAllWeek(normalizeWeeklyHours(null))).toBe(true);
  });

  it("is false when one day has a window", () => {
    expect(isClosedAllWeek(DEFAULT_WEEKLY_HOURS)).toBe(false);
  });
});

describe("hoursOf", () => {
  it("gives a shop that never opened the setting a sensible week", () => {
    // Null is "not configured", and an empty week would read as a broken
    // calendar rather than a closed shop.
    expect(hoursOf(null)).toEqual(DEFAULT_WEEKLY_HOURS);
    expect(hoursOf(undefined)).toEqual(DEFAULT_WEEKLY_HOURS);
  });

  it("returns a valid stored week untouched", () => {
    const stored = normalizeWeeklyHours([
      [],
      [{ from: "10:00", to: "14:00" }],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(hoursOf(stored)).toEqual(stored);
  });

  it("repairs a week an older build wrote rather than trusting it", () => {
    const repaired = hoursOf([
      [{ from: "09:00", to: "12:00" }, { from: "11:00", to: "17:00" }],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(repaired[0]).toEqual([{ from: "09:00", to: "17:00" }]);
  });

  it.each(["nonsense", 42, { monday: "9-5" }])(
    "falls back to something usable for %j",
    (stored) => {
      expect(isWeeklyHours(hoursOf(stored))).toBe(true);
    },
  );

  it("normalises even a week that validates, because overlap is legal to isWeeklyHours", () => {
    /*
     * The gap this closed. Two windows can each be well-formed and still
     * overlap; `isWeeklyHours` checks them one at a time and says yes. The
     * slot generator assumes they are disjoint and sorted, so returning the
     * stored value untouched would have offered the same time twice.
     */
    const overlapping = [
      [
        { from: "09:00", to: "13:00" },
        { from: "11:00", to: "17:00" },
      ],
      [], [], [], [], [], [],
    ];
    expect(isWeeklyHours(overlapping)).toBe(true);
    expect(hoursOf(overlapping)[0]).toEqual([{ from: "09:00", to: "17:00" }]);
  });

  it("keeps a shop that deliberately closed every day closed", () => {
    // Only null means "never configured". An all-closed week is a decision.
    const closed = [[], [], [], [], [], [], []];
    expect(hoursOf(closed)).toEqual(closed);
  });
});
