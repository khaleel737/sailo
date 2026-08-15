import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  COUNTRY_GROUPS,
  EEA,
  EU,
  countriesByName,
  countryName,
  isCountryCode,
  normalizeCountry,
} from "./countries";

/**
 * The list a shipping zone is checked against.
 *
 * A code missing from it cannot be shipped to, and a code in it that CLDR has
 * never heard of renders as itself in a dropdown — so the list being right is
 * not a detail, it is the feature.
 */

describe("the country list", () => {
  it("holds each code once", () => {
    // A duplicate would draw the same country twice in the picker and count it
    // twice in "27 countries".
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
  });

  it("is alpha-2 and uppercase throughout", () => {
    // The column stores exactly this shape, and `shipsTo` compares by equality
    // rather than case-insensitively — one lowercase entry here would be a
    // country that silently never matches.
    expect(COUNTRY_CODES.filter((c) => !/^[A-Z]{2}$/.test(c))).toEqual([]);
  });

  it("names every code in something other than the code itself", () => {
    /*
     * `Intl.DisplayNames` with `fallback: "code"` hands back the input when it
     * doesn't recognise it, so a code the runtime has never heard of shows up
     * as two letters in a dropdown of real country names. XK is the one entry
     * that is not officially assigned, and this is the test that would catch
     * the day a runtime stops knowing it.
     */
    const unnamed = COUNTRY_CODES.filter((code) => countryName(code) === code);
    expect(unnamed).toEqual([]);
  });
});

describe("normalizeCountry", () => {
  it("accepts what a form actually sends", () => {
    expect(normalizeCountry("hr")).toBe("HR");
    expect(normalizeCountry("  de  ")).toBe("DE");
    expect(normalizeCountry("US")).toBe("US");
  });

  it("returns null for anything that isn't a code, without complaining", () => {
    /*
     * Null is not an error being reported. Free text is what every order
     * placed before the country dropdown existed holds, and a blank field is
     * ordinary — what neither is, is something a zone can be checked against,
     * and that is the caller's problem to answer.
     */
    expect(normalizeCountry("Hrvatska")).toBeNull();
    expect(normalizeCountry("")).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
    expect(normalizeCountry(undefined)).toBeNull();
    // Two letters, still not a country.
    expect(normalizeCountry("ZZ")).toBeNull();
  });

  it("agrees with isCountryCode", () => {
    expect(isCountryCode("HR")).toBe(true);
    expect(isCountryCode("hr")).toBe(false);
    expect(isCountryCode("XX")).toBe(false);
  });
});

describe("the presets", () => {
  it("names 27 EU members and puts all of them in the EEA", () => {
    expect(EU).toHaveLength(27);
    expect(EEA).toHaveLength(30);
    expect(EU.every((code) => EEA.includes(code))).toBe(true);
  });

  it("only ever writes codes the zone can be checked against", () => {
    /*
     * A preset is a button that writes codes into the column. One code in it
     * that `normalizeCountry` rejects would be a country a seller believes
     * they ship to and `shipsTo` refuses for ever.
     */
    for (const group of COUNTRY_GROUPS) {
      const strays = group.codes.filter((code) => !isCountryCode(code));
      expect(strays, `${group.key} has codes outside the list`).toEqual([]);
      expect(
        new Set(group.codes).size,
        `${group.key} repeats a country`,
      ).toBe(group.codes.length);
    }
  });
});

describe("countriesByName", () => {
  it("sorts by the name the reader sees, not by the code", () => {
    // Sorting by code puts Germany under D-E and Austria under A-T in every
    // language, which is only right in one of them.
    const names = countriesByName("en").map((c) => c.name);
    expect(names).toEqual(names.toSorted(new Intl.Collator("en").compare));
  });

  it("returns the whole list whatever the language", () => {
    expect(countriesByName("hr")).toHaveLength(COUNTRY_CODES.length);
  });
});
