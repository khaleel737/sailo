import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  COUNTRY_GROUPS,
  EEA,
  EU,
  countriesByName,
  countryFromTimeZone,
  countryName,
  deviceTimeZone,
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
    /*
     * `[...names].sort(…)` — the spread is load-bearing, not decoration. This
     * asserts the list equals a *sorted copy of itself*, so sorting `names` in
     * place would compare it to itself and pass however `countriesByName`
     * ordered things. `toSorted` copied for us; `.sort` does not, and this
     * package is typed against Hermes now, which has no `toSorted`.
     */
    expect(names).toEqual([...names].sort(new Intl.Collator("en").compare));
  });

  it("returns the whole list whatever the language", () => {
    expect(countriesByName("hr")).toHaveLength(COUNTRY_CODES.length);
  });
});

describe("countryFromTimeZone", () => {
  it("places a zone in its country", () => {
    expect(countryFromTimeZone("Europe/Zagreb")).toBe("HR");
    expect(countryFromTimeZone("Europe/Berlin")).toBe("DE");
    expect(countryFromTimeZone("America/New_York")).toBe("US");
    expect(countryFromTimeZone("Asia/Tokyo")).toBe("JP");
  });

  it("handles a country with several zones", () => {
    // Germany has Busingen as well as Berlin; the US has thirty.
    expect(countryFromTimeZone("Europe/Busingen")).toBe("DE");
    expect(countryFromTimeZone("America/Anchorage")).toBe("US");
    expect(countryFromTimeZone("Pacific/Honolulu")).toBe("US");
  });

  it("only ever answers with a country the caller offered", () => {
    // A Croatia-only shop must not have the dropdown filled with Germany just
    // because that is where the buyer's laptop thinks it is.
    expect(countryFromTimeZone("Europe/Berlin", ["HR"])).toBeNull();
    expect(countryFromTimeZone("Europe/Zagreb", ["HR", "SI"])).toBe("HR");
  });

  it("returns null rather than guessing when it cannot tell", () => {
    expect(countryFromTimeZone("Not/AZone")).toBeNull();
    expect(countryFromTimeZone("")).toBeNull();
    expect(countryFromTimeZone(null)).toBeNull();
    expect(countryFromTimeZone(undefined)).toBeNull();
  });

  it("ignores junk in the candidate list instead of throwing", () => {
    expect(countryFromTimeZone("Europe/Zagreb", ["", "ZZZ", "hr"])).toBeNull();
    expect(countryFromTimeZone("Europe/Zagreb", ["ZZZ", "HR"])).toBe("HR");
  });

  it("is quick enough to run against every country on mount", () => {
    // The unrestricted case asks about 244 countries in one pass. It runs in a
    // buyer's checkout, so it has to be free rather than merely fast.
    const started = performance.now();
    countryFromTimeZone("Pacific/Auckland");
    countryFromTimeZone("Africa/Lagos");
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe("deviceTimeZone", () => {
  it("reports a zone Intl agrees is one", () => {
    const zone = deviceTimeZone();
    expect(zone).toBeTruthy();
    expect(() => new Intl.DateTimeFormat("en", { timeZone: zone! })).not.toThrow();
  });
});
