import { describe, expect, it } from "vitest";
import { warmUpCeiling } from "./quota";

/**
 * The ramp a new shop climbs.
 *
 * Tested at the boundaries and nowhere else, because the only interesting
 * question a step table asks is which side of a day a shop is on — an
 * off-by-one here either lets a day-old account send a thousand messages on a
 * shared domain, or holds a two-week-old shop at a hundred forever.
 */

const DAY = 86_400_000;

const CREATED = new Date("2026-01-01T09:00:00Z");

/** The ceiling for a shop `days` (and `hours`) old. */
function atAge(days: number, hours = 0): number | null {
  return warmUpCeiling(
    CREATED,
    new Date(CREATED.getTime() + days * DAY + hours * 3_600_000),
  );
}

describe("the warm-up ceiling", () => {
  it("starts small on the day the shop is created", () => {
    expect(atAge(0)).toBe(100);
  });

  it("counts elapsed days, not calendar days", () => {
    // 23 hours old is still day zero, even if the clock has passed midnight.
    expect(atAge(0, 23)).toBe(100);
  });

  it("climbs at each step boundary", () => {
    expect(atAge(2)).toBe(100);
    expect(atAge(3)).toBe(500);
    expect(atAge(6)).toBe(500);
    expect(atAge(7)).toBe(1_000);
    expect(atAge(13)).toBe(1_000);
  });

  it("is over on day fourteen", () => {
    expect(atAge(14)).toBeNull();
  });

  it("stays over for an old shop", () => {
    expect(atAge(900)).toBeNull();
  });

  /*
   * A row dated in the future — clock skew between the app and the database,
   * or a seeded fixture — reads as a negative age. Floored to day zero rather
   * than falling off the end of the table, which would read as *warmed up* and
   * hand a brand-new shop its whole allowance.
   */
  it("treats a shop created in the future as brand new", () => {
    expect(atAge(-5)).toBe(100);
  });
});
