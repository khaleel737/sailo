import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

/**
 * The guard that stands in front of every id-shaped route parameter.
 *
 * Split out of `money/currency-parsing.test.ts` — see the note in `./slug.test.ts`.
 */

describe("isUuid", () => {
  it("accepts a real uuid in either case", () => {
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isUuid("A1B2C3D4-E5F6-7890-ABCD-EF1234567890")).toBe(true);
  });

  it("refuses what Postgres would raise on", () => {
    for (const value of [
      "x",
      "",
      "not-a-uuid",
      "00000000-0000-0000-0000-00000000000",
      "00000000-0000-0000-0000-0000000000000",
      "00000000_0000_0000_0000_000000000000",
      "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
      " 00000000-0000-0000-0000-000000000000",
    ]) {
      expect(isUuid(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("refuses a non-string without being coerced first", () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(isUuid(value)).toBe(false);
    }
  });
});
