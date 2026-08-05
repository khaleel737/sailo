import { describe, expect, it } from "vitest";
import { toLocalInput } from "./local-time";

/**
 * A booking is a wall-clock time. `datetime-local` carries no timezone, so the
 * value has to be built from the buyer's own local parts — anything derived
 * from an ISO string would show them UTC and book the wrong hour.
 */
describe("toLocalInput", () => {
  it("formats as datetime-local expects", () => {
    const d = new Date(2026, 7, 4, 9, 5);
    expect(toLocalInput(d)).toBe("2026-08-04T09:05");
  });

  it("pads every part to two digits", () => {
    // Month 0 is January, and an unpadded "2026-1-4T9:5" is rejected outright.
    expect(toLocalInput(new Date(2026, 0, 4, 9, 5))).toBe("2026-01-04T09:05");
  });

  it("keeps midnight and noon apart", () => {
    expect(toLocalInput(new Date(2026, 7, 4, 0, 0))).toBe("2026-08-04T00:00");
    expect(toLocalInput(new Date(2026, 7, 4, 12, 0))).toBe("2026-08-04T12:00");
  });

  it("reads local parts, so the string matches what the buyer sees", () => {
    const d = new Date(2026, 7, 4, 23, 30);
    const [datePart, timePart] = toLocalInput(d).split("T");
    expect(datePart).toBe(`2026-08-${String(d.getDate()).padStart(2, "0")}`);
    expect(timePart).toBe(
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    );
  });

  it("survives the end of a month and a year", () => {
    expect(toLocalInput(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31T23:59");
  });
});
