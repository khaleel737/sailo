import { describe, expect, it } from "vitest";
import { MAX_SESSIONS, repeatWeekly } from "./tickets";

/**
 * The whole of recurrence in spec 50 is "repeat weekly × N", so what is pinned
 * here is the one thing a seller would notice and could not explain: a 19:00
 * class that becomes an 18:00 class halfway through the run.
 */

describe("repeatWeekly", () => {
  it("adds dates after the one it was given, not including it", () => {
    expect(repeatWeekly("2026-09-01T19:00", 3)).toEqual([
      "2026-09-08T19:00",
      "2026-09-15T19:00",
      "2026-09-22T19:00",
    ]);
  });

  it("keeps the clock time across a daylight-saving change", () => {
    /*
     * Europe/London puts its clocks back on 25 October 2026 and the US does so
     * a week later, so a seller in either zone generating a weekly class across
     * that weekend is the ordinary case rather than the exotic one. Adding
     * seven days against the browser's own zone moves 19:00 to 18:00 for the
     * rest of the run — a whole term of classes an hour early, with nothing on
     * any screen saying why.
     */
    expect(repeatWeekly("2026-10-20T19:00", 2)).toEqual([
      "2026-10-27T19:00",
      "2026-11-03T19:00",
    ]);
  });

  it("crosses a month and a year without drifting", () => {
    expect(repeatWeekly("2026-12-29T09:30", 2)).toEqual([
      "2027-01-05T09:30",
      "2027-01-12T09:30",
    ]);
  });

  it("answers nothing for a date the seller has not chosen yet", () => {
    // A blank first date is an unfinished form, not an error to shout about.
    expect(repeatWeekly("", 4)).toEqual([]);
    expect(repeatWeekly("not a date", 4)).toEqual([]);
  });

  it("clamps the count to what one event may hold", () => {
    expect(repeatWeekly("2026-09-01T19:00", 0)).toHaveLength(1);
    expect(repeatWeekly("2026-09-01T19:00", -5)).toHaveLength(1);
    expect(repeatWeekly("2026-09-01T19:00", 500)).toHaveLength(MAX_SESSIONS);
    expect(repeatWeekly("2026-09-01T19:00", Number.NaN)).toEqual([]);
  });
});
