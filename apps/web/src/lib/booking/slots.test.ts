import { describe, expect, it } from "vitest";
import {
  isOfferedSlot,
  overlaps,
  slotsForDays,
  slotsOnDate,
  todayIn,
  type Busy,
  type SlotOptions,
} from "@/lib/booking/slots";
import { DEFAULT_WEEKLY_HOURS, normalizeWeeklyHours } from "@/lib/booking/hours";

/**
 * What a buyer is allowed to pick.
 *
 * Every rule here decides whether an appointment can be sold, so each is
 * tested at its edge rather than in the middle: the last slot that still fits
 * before closing, the first one past the notice period, the slot that clashes
 * by a minute, and the hour a daylight-saving change deletes.
 */

/** 2026-08-07 is a Friday; 08-08 a Saturday, 08-09 a Sunday. */
const FRIDAY = { year: 2026, month: 8, day: 7 };
const SATURDAY = { year: 2026, month: 8, day: 8 };

const base = (over: Partial<SlotOptions> = {}): SlotOptions => ({
  hours: DEFAULT_WEEKLY_HOURS,
  timeZone: "UTC",
  durationMinutes: 60,
  leadHours: 0,
  busy: [],
  now: new Date("2026-08-01T00:00:00Z"),
  ...over,
});

const at = (iso: string) => new Date(iso);
const starts = (slots: { startsAt: Date }[]) =>
  slots.map((s) => s.startsAt.toISOString());

describe("overlaps", () => {
  const nineToTen: Busy = {
    startsAt: at("2026-08-07T09:00:00Z"),
    endsAt: at("2026-08-07T10:00:00Z"),
  };

  it("does not clash with the slot that starts as it ends", () => {
    /*
     * The half-open rule. Treating the end as inclusive would lose one
     * appointment in every back-to-back pair a seller runs.
     */
    expect(
      overlaps(nineToTen, {
        startsAt: at("2026-08-07T10:00:00Z"),
        endsAt: at("2026-08-07T11:00:00Z"),
      }),
    ).toBe(false);
  });

  it("clashes when one starts a minute before the other ends", () => {
    expect(
      overlaps(nineToTen, {
        startsAt: at("2026-08-07T09:59:00Z"),
        endsAt: at("2026-08-07T10:59:00Z"),
      }),
    ).toBe(true);
  });

  it("clashes when one wholly contains the other", () => {
    expect(
      overlaps(nineToTen, {
        startsAt: at("2026-08-07T08:00:00Z"),
        endsAt: at("2026-08-07T12:00:00Z"),
      }),
    ).toBe(true);
  });

  it("is symmetric", () => {
    const other = {
      startsAt: at("2026-08-07T09:30:00Z"),
      endsAt: at("2026-08-07T10:30:00Z"),
    };
    expect(overlaps(nineToTen, other)).toBe(overlaps(other, nineToTen));
  });
});

describe("slotsOnDate — the shape of a day", () => {
  it("fills a nine-to-five day with hour slots", () => {
    const slots = slotsOnDate(FRIDAY, base());
    expect(slots).toHaveLength(8);
    expect(starts(slots)[0]).toBe("2026-08-07T09:00:00.000Z");
  });

  it("stops early enough for the last appointment to finish", () => {
    /*
     * The edge that decides whether a seller works late. A 90-minute service
     * in a nine-to-five day cannot start at four, because it would run to
     * half five.
     *
     * The grid is fixed from opening time, so the slots are 09:00, 10:30,
     * 12:00, 13:30, 15:00 — and the last ends at 16:30, leaving half an hour
     * of the day unsold. That is the price of a predictable grid, and it is
     * the seller's to reclaim with `stepMinutes` if they want it.
     */
    const slots = slotsOnDate(FRIDAY, base({ durationMinutes: 90 }));
    expect(starts(slots)).toEqual([
      "2026-08-07T09:00:00.000Z",
      "2026-08-07T10:30:00.000Z",
      "2026-08-07T12:00:00.000Z",
      "2026-08-07T13:30:00.000Z",
      "2026-08-07T15:00:00.000Z",
    ]);
    expect(slots.at(-1)?.endsAt.toISOString()).toBe("2026-08-07T16:30:00.000Z");
  });

  it("never offers a slot that would run past closing", () => {
    // The property behind the case above, checked across awkward lengths.
    for (const durationMinutes of [20, 45, 50, 90, 100, 240]) {
      const slots = slotsOnDate(FRIDAY, base({ durationMinutes }));
      const closes = at("2026-08-07T17:00:00.000Z");
      for (const slot of slots) {
        expect(slot.endsAt.getTime(), `${durationMinutes}m`).toBeLessThanOrEqual(
          closes.getTime(),
        );
      }
    }
  });

  it("offers nothing on a day the shop is closed", () => {
    expect(slotsOnDate(SATURDAY, base())).toEqual([]);
  });

  it("offers nothing when the service has no duration", () => {
    // A bookable service with no length has no slot to describe.
    for (const durationMinutes of [0, -30, Number.NaN]) {
      expect(slotsOnDate(FRIDAY, base({ durationMinutes }))).toEqual([]);
    }
  });

  it("honours a separate step, so a shop can start on the half hour", () => {
    const slots = slotsOnDate(
      FRIDAY,
      base({ durationMinutes: 60, stepMinutes: 30 }),
    );
    expect(starts(slots).slice(0, 3)).toEqual([
      "2026-08-07T09:00:00.000Z",
      "2026-08-07T09:30:00.000Z",
      "2026-08-07T10:00:00.000Z",
    ]);
    // Still stops so the last one finishes by five.
    expect(starts(slots).at(-1)).toBe("2026-08-07T16:00:00.000Z");
  });

  it("covers both halves of a day that closes for lunch", () => {
    const hours = normalizeWeeklyHours([
      [],
      [],
      [],
      [],
      [],
      [
        { from: "09:00", to: "12:00" },
        { from: "14:00", to: "17:00" },
      ],
      [],
    ]);
    const slots = slotsOnDate(FRIDAY, base({ hours }));
    expect(starts(slots)).toEqual([
      "2026-08-07T09:00:00.000Z",
      "2026-08-07T10:00:00.000Z",
      "2026-08-07T11:00:00.000Z",
      "2026-08-07T14:00:00.000Z",
      "2026-08-07T15:00:00.000Z",
      "2026-08-07T16:00:00.000Z",
    ]);
  });

  it("returns slots in order even when the windows were not", () => {
    const hours = normalizeWeeklyHours([
      [],
      [],
      [],
      [],
      [],
      [
        { from: "14:00", to: "17:00" },
        { from: "09:00", to: "12:00" },
      ],
      [],
    ]);
    const times = starts(slotsOnDate(FRIDAY, base({ hours })));
    expect(times).toEqual(times.toSorted());
  });
});

describe("slotsOnDate — notice period", () => {
  it("hides slots inside the notice the seller asked for", () => {
    /*
     * A shop needing a day's notice at 08:00 on the day itself must offer
     * nothing that day, however open it is.
     */
    const slots = slotsOnDate(
      FRIDAY,
      base({ leadHours: 24, now: at("2026-08-07T08:00:00Z") }),
    );
    expect(slots).toEqual([]);
  });

  it("offers the first slot that clears the notice, and not the one before", () => {
    const slots = slotsOnDate(
      FRIDAY,
      base({ leadHours: 4, now: at("2026-08-07T08:30:00Z") }),
    );
    // 08:30 + 4h = 12:30, so noon is too soon and one o'clock is not.
    expect(starts(slots)[0]).toBe("2026-08-07T13:00:00.000Z");
  });

  it("treats a slot exactly on the boundary as bookable", () => {
    const slots = slotsOnDate(
      FRIDAY,
      base({ leadHours: 4, now: at("2026-08-07T09:00:00Z") }),
    );
    // 09:00 + 4h is exactly 13:00, which is still far enough ahead.
    expect(starts(slots)[0]).toBe("2026-08-07T13:00:00.000Z");
  });

  it("treats a negative notice as none rather than reaching into the past", () => {
    const slots = slotsOnDate(
      FRIDAY,
      base({ leadHours: -48, now: at("2026-08-07T12:00:00Z") }),
    );
    expect(starts(slots)[0]).toBe("2026-08-07T12:00:00.000Z");
  });
});

describe("slotsOnDate — what is already booked", () => {
  it("removes a slot that is taken", () => {
    const slots = slotsOnDate(
      FRIDAY,
      base({
        busy: [
          {
            startsAt: at("2026-08-07T11:00:00Z"),
            endsAt: at("2026-08-07T12:00:00Z"),
          },
        ],
      }),
    );
    expect(starts(slots)).not.toContain("2026-08-07T11:00:00.000Z");
    expect(slots).toHaveLength(7);
  });

  it("removes every slot a longer booking runs through", () => {
    /*
     * The seller may have shortened the service since. A two-hour appointment
     * still blocks both hours it occupies, not just the one it starts in.
     */
    const slots = slotsOnDate(
      FRIDAY,
      base({
        busy: [
          {
            startsAt: at("2026-08-07T11:00:00Z"),
            endsAt: at("2026-08-07T13:00:00Z"),
          },
        ],
      }),
    );
    expect(starts(slots)).not.toContain("2026-08-07T11:00:00.000Z");
    expect(starts(slots)).not.toContain("2026-08-07T12:00:00.000Z");
    expect(slots).toHaveLength(6);
  });

  it("keeps the slot that begins exactly as a booking ends", () => {
    const slots = slotsOnDate(
      FRIDAY,
      base({
        busy: [
          {
            startsAt: at("2026-08-07T10:00:00Z"),
            endsAt: at("2026-08-07T11:00:00Z"),
          },
        ],
      }),
    );
    expect(starts(slots)).toContain("2026-08-07T11:00:00.000Z");
  });

  it("ignores a booking on another day", () => {
    const slots = slotsOnDate(
      FRIDAY,
      base({
        busy: [
          {
            startsAt: at("2026-08-10T11:00:00Z"),
            endsAt: at("2026-08-10T12:00:00Z"),
          },
        ],
      }),
    );
    expect(slots).toHaveLength(8);
  });
});

describe("slotsOnDate — zones and daylight saving", () => {
  it("reads opening hours as the shop's wall clock, not the server's", () => {
    const slots = slotsOnDate(FRIDAY, base({ timeZone: "America/New_York" }));
    // Nine in New York is 13:00Z in August.
    expect(starts(slots)[0]).toBe("2026-08-07T13:00:00.000Z");
    expect(slots).toHaveLength(8);
  });

  it("works in a half-hour zone", () => {
    const slots = slotsOnDate(FRIDAY, base({ timeZone: "Asia/Kolkata" }));
    expect(starts(slots)[0]).toBe("2026-08-07T03:30:00.000Z");
  });

  it("drops the hour the clocks skip, and keeps the day open", () => {
    /*
     * 2026-03-08 is a Sunday, so open the weekend and use New York, which
     * jumps 02:00 → 03:00 that morning. A slot at two does not exist; the
     * rest of the day is ordinary.
     */
    const hours = normalizeWeeklyHours([
      [{ from: "01:00", to: "05:00" }],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    const slots = slotsOnDate(
      { year: 2026, month: 3, day: 8 },
      base({ hours, timeZone: "America/New_York", leadHours: 0, now: at("2026-01-01T00:00:00Z") }),
    );

    const local = slots.map((s) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        hour12: false,
      }).format(s.startsAt),
    );
    expect(local).toEqual(["01", "03", "04"]);
  });

  it("keeps the repeated hour once, not twice", () => {
    /*
     * The autumn mirror: 2026-11-01, New York repeats 01:00–02:00. The
     * calendar shows one o'clock once, so the shop sells it once.
     */
    const hours = normalizeWeeklyHours([
      [{ from: "01:00", to: "04:00" }],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    const slots = slotsOnDate(
      { year: 2026, month: 11, day: 1 },
      base({ hours, timeZone: "America/New_York", now: at("2026-01-01T00:00:00Z") }),
    );
    expect(new Set(starts(slots)).size).toBe(slots.length);
    expect(starts(slots)[0]).toBe("2026-11-01T05:00:00.000Z");
  });
});

describe("slotsForDays", () => {
  it("keeps closed days in the list rather than skipping them", () => {
    // A calendar has to show Saturday as shut, not jump from Friday to Monday.
    const days = slotsForDays(FRIDAY, 3, base());
    expect(days.map((d) => d.date)).toEqual([
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
    expect(days[1]?.slots).toEqual([]);
  });

  it("caps the span, so a crafted query cannot ask for ten years", () => {
    expect(slotsForDays(FRIDAY, 10_000, base())).toHaveLength(90);
  });

  it.each([0, -5])("returns nothing for a span of %i", (days) => {
    expect(slotsForDays(FRIDAY, days, base())).toEqual([]);
  });
});

describe("isOfferedSlot — the server's own check", () => {
  it("accepts a slot the shop is offering", () => {
    expect(isOfferedSlot(at("2026-08-07T09:00:00Z"), base())).toBe(true);
  });

  it("refuses a time between slots", () => {
    // The browser was given a list; this is what stops a hand-edited payload.
    expect(isOfferedSlot(at("2026-08-07T09:30:00Z"), base())).toBe(false);
  });

  it("refuses a time outside opening hours", () => {
    expect(isOfferedSlot(at("2026-08-07T03:00:00Z"), base())).toBe(false);
  });

  it("refuses a slot on a closed day", () => {
    expect(isOfferedSlot(at("2026-08-08T09:00:00Z"), base())).toBe(false);
  });

  it("refuses a slot that has since been taken", () => {
    /*
     * The race the check exists for: the buyer was shown a free list, someone
     * else booked, and the order arrived afterwards.
     */
    const opts = base({
      busy: [
        {
          startsAt: at("2026-08-07T09:00:00Z"),
          endsAt: at("2026-08-07T10:00:00Z"),
        },
      ],
    });
    expect(isOfferedSlot(at("2026-08-07T09:00:00Z"), opts)).toBe(false);
  });

  it("refuses a slot inside the notice period", () => {
    expect(
      isOfferedSlot(
        at("2026-08-07T09:00:00Z"),
        base({ leadHours: 24, now: at("2026-08-07T00:00:00Z") }),
      ),
    ).toBe(false);
  });

  it("refuses an invalid date rather than throwing", () => {
    expect(isOfferedSlot(new Date("nonsense"), base())).toBe(false);
  });
});

describe("todayIn", () => {
  it("is the shop's date, not the server's", () => {
    // 23:30Z on the 7th is already the 8th in Kolkata.
    expect(todayIn("Asia/Kolkata", at("2026-08-07T23:30:00Z"))).toEqual({
      year: 2026,
      month: 8,
      day: 8,
    });
    expect(todayIn("UTC", at("2026-08-07T23:30:00Z"))).toEqual({
      year: 2026,
      month: 8,
      day: 7,
    });
  });
});
