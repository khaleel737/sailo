import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone";

/**
 * Phone numbers, as stored.
 *
 * Split out of `money/currency-parsing.test.ts` — see the note in `./slug.test.ts`.
 */

describe("normalizePhone", () => {
  it("keeps only the digits, so one number has one form", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizePhone("+1-555-123-4567")).toBe("15551234567");
  });

  it("returns empty for something with no digits at all", () => {
    // Empty is what lets a caller treat it as absent rather than as a number.
    expect(normalizePhone("not a phone")).toBe("");
  });
});
