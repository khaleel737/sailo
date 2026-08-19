import { describe, expect, it } from "vitest";
import {
  DEFAULT_CODE_PATTERN,
  MIN_CODE_ENTROPY_CHARS,
  RESERVED_FOLDED_LENGTHS,
  checkCodePattern,
  licenseKeyPrefix,
  mintCode,
  newLicenseKey,
  normalizeLicenseKey,
} from "./codes";

/** The fold `admitAnyCode` applies, repeated here so the assertions are honest. */
const fold = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/I|L/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");

describe("code patterns", () => {
  it("accepts the default", () => {
    const check = checkCodePattern(DEFAULT_CODE_PATTERN);
    expect(check.ok).toBe(true);
  });

  it("uppercases what the seller typed", () => {
    const check = checkCodePattern("sailo-xxxx-xxxx-xxxx");
    expect(check.ok && check.pattern).toBe("SAILO-XXXX-XXXX-XXXX");
  });

  it("refuses a pattern with nothing random in it", () => {
    expect(checkCodePattern("SAILO-2026")).toEqual({
      ok: false,
      reason: "not_enough_random",
    });
  });

  it("refuses a pattern with too little random in it", () => {
    // Nine placeholders is 45 bits, under the floor a bearer token needs.
    const nine = "X".repeat(MIN_CODE_ENTROPY_CHARS - 1);
    expect(checkCodePattern(`AB-${nine}`)).toEqual({
      ok: false,
      reason: "not_enough_random",
    });
  });

  it("refuses blank and over-long patterns", () => {
    expect(checkCodePattern("")).toEqual({ ok: false, reason: "empty" });
    expect(checkCodePattern(null)).toEqual({ ok: false, reason: "empty" });
    expect(checkCodePattern("X".repeat(65))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  /*
   * The load-bearing one, and the third side of the property `passes.test.ts`
   * pins from the other two. `admitAnyCode` tries a ticket, falls through to a
   * member pass on `not_found`, and that is safe only because a folded string
   * cannot be a candidate for both — ten characters against twelve. A pool
   * code that folded to either length would put a third string into the same
   * space, and nothing at a door would notice until it mattered.
   */
  it("refuses a pattern that folds to a ticket's length or a pass's", () => {
    for (const length of RESERVED_FOLDED_LENGTHS) {
      expect(checkCodePattern("X".repeat(length))).toEqual({
        ok: false,
        reason: "collides_with_scan_codes",
      });
      // Literals count towards the fold too: five literal characters plus
      // seven placeholders is still twelve.
      const literals = "SAILO";
      const placeholders = "X".repeat(length - literals.length);
      if (placeholders.length >= MIN_CODE_ENTROPY_CHARS) {
        expect(checkCodePattern(`${literals}-${placeholders}`)).toEqual({
          ok: false,
          reason: "collides_with_scan_codes",
        });
      }
    }
  });
});

describe("minting a pool code", () => {
  it("keeps the literals and fills every placeholder", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(mintCode(DEFAULT_CODE_PATTERN)).toMatch(
        /^SAILO-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/,
      );
    }
  });

  it("never uses the four lookalike letters", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(mintCode("XXXXXXXXXXXXXX")).not.toMatch(/[ILOU]/);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(mintCode(DEFAULT_CODE_PATTERN));
    expect(seen.size).toBe(500);
  });

  it("falls back to the default rather than minting from a refused pattern", () => {
    // A caller that skipped the check must not get a four-character code.
    expect(mintCode("AB")).toMatch(/^SAILO-/);
  });

  it("cannot be folded into a ticket's length or a pass's", () => {
    for (let i = 0; i < 100; i += 1) {
      const folded = fold(mintCode(DEFAULT_CODE_PATTERN));
      expect(RESERVED_FOLDED_LENGTHS).not.toContain(folded.length);
    }
  });
});

describe("licence keys", () => {
  it("is twenty characters in four groups", () => {
    expect(newLicenseKey()).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  });

  it("cannot be folded into a ticket's length or a pass's", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(fold(newLicenseKey())).toHaveLength(20);
    }
  });

  it("never uses the four lookalike letters", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(newLicenseKey()).not.toMatch(/[ILOU]/);
    }
  });

  it("normalizes what a customer's software sent", () => {
    const key = newLicenseKey();
    const bare = key.replace(/-/g, "");
    expect(normalizeLicenseKey(bare.toLowerCase())).toBe(bare);
    expect(normalizeLicenseKey(` ${key} `)).toBe(bare);
  });

  it("folds the four lookalikes back to what was issued", () => {
    expect(normalizeLicenseKey("IL0U-1234-5678-9ABC")).toBe("110V123456789ABC");
  });

  it("logs a prefix and never the key", () => {
    const key = newLicenseKey();
    const prefix = licenseKeyPrefix(key);
    expect(prefix).toHaveLength(5);
    expect(key.replace(/-/g, "")).toContain(prefix);
    expect(prefix.length).toBeLessThan(key.length);
  });
});
