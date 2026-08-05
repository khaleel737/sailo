import { describe, expect, it } from "vitest";
import { parseBooking } from "./booking";

const NOW = new Date("2026-06-01T12:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

describe("parseBooking", () => {
  it("accepts a time past the seller's lead time", () => {
    expect(parseBooking(hours(48), 24, NOW)).toEqual(new Date(hours(48)));
  });

  it("accepts a time exactly at the lead time", () => {
    expect(parseBooking(hours(24), 24, NOW)).not.toBeNull();
  });

  it("refuses a time inside the lead time", () => {
    // The seller said they need a day's notice; taking the booking anyway
    // sells them a slot they already said they can't work.
    expect(parseBooking(hours(12), 24, NOW)).toBeNull();
  });

  it("refuses a time in the past", () => {
    expect(parseBooking(hours(-1), 0, NOW)).toBeNull();
  });

  it("refuses a booking more than a year out", () => {
    // Almost always a mistyped year rather than a real intention.
    expect(parseBooking(hours(24 * 400), 0, NOW)).toBeNull();
  });

  it.each([[undefined], [""], ["   "], ["not a date"], ["2026-13-45"]])(
    "returns null for %s",
    (value) => {
      expect(parseBooking(value as string | undefined, 0, NOW)).toBeNull();
    },
  );

  it("treats a negative lead time as none", () => {
    expect(parseBooking(hours(1), -100, NOW)).not.toBeNull();
  });
});
