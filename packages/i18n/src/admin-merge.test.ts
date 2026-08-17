import { describe, expect, it } from "vitest";
import { mergeAdmin } from "./admin-merge";
import { adminEn } from "./admin/en";

/**
 * The rule that lets the admin be translated a section at a time.
 *
 * This is what makes 1,077 English keys and a locale file holding forty of them a
 * working screen rather than a blank one — and it is the same function on the server and
 * on the phone, because two implementations of "fall back to English" is how a label goes
 * missing on one surface only.
 *
 * The behaviour worth pinning is what it does with what it is *not* given: a missing
 * section, a missing key, an empty object. Each of those is the normal state of a
 * half-translated locale, not an error.
 */

const SECTION = Object.keys(adminEn)[0] as keyof typeof adminEn;
const KEY = Object.keys(adminEn[SECTION])[0]!;

describe("mergeAdmin", () => {
  it("returns every section English has", () => {
    const merged = mergeAdmin({});

    expect(Object.keys(merged).sort()).toEqual(Object.keys(adminEn).sort());
  });

  it("is English when given nothing", () => {
    expect(mergeAdmin({})).toEqual(adminEn);
  });

  it("takes the translation where there is one", () => {
    const merged = mergeAdmin({ [SECTION]: { [KEY]: "übersetzt" } } as never);

    expect(merged[SECTION][KEY as never]).toBe("übersetzt");
  });

  /*
   * The half-translated section, which is the ordinary case. Everything the locale did
   * not say still has to read as English rather than as a gap.
   */
  it("keeps English for the keys a section did not translate", () => {
    const englishSection = adminEn[SECTION] as Record<string, string>;
    const untouched = Object.keys(englishSection).find((k) => k !== KEY);

    const merged = mergeAdmin({ [SECTION]: { [KEY]: "übersetzt" } } as never);

    expect((merged[SECTION] as Record<string, string>)[untouched!]).toBe(
      englishSection[untouched!],
    );
  });

  it("leaves a section it was given nothing for entirely English", () => {
    const other = Object.keys(adminEn).find((s) => s !== SECTION) as keyof typeof adminEn;

    const merged = mergeAdmin({ [SECTION]: { [KEY]: "übersetzt" } } as never);

    expect(merged[other]).toEqual(adminEn[other]);
  });

  /*
   * A section name the dictionary does not have is dropped rather than added. That is
   * what iterating English's keys buys, and it is why a renamed section in a translation
   * file cannot introduce a phantom section the app then reads from.
   */
  it("ignores a section English does not have", () => {
    const merged = mergeAdmin({ notASection: { a: "b" } } as never);

    expect(merged).not.toHaveProperty("notASection");
    expect(Object.keys(merged).sort()).toEqual(Object.keys(adminEn).sort());
  });

  it("does not mutate the English dictionary it merges over", () => {
    const before = JSON.stringify(adminEn);

    mergeAdmin({ [SECTION]: { [KEY]: "übersetzt" } } as never);

    // A merge that wrote into `adminEn` would translate every *other* locale too, in
    // whatever order the requests happened to arrive.
    expect(JSON.stringify(adminEn)).toBe(before);
  });

  it("gives each caller its own object, so one request cannot edit another's", () => {
    const first = mergeAdmin({});
    const second = mergeAdmin({});

    expect(first).not.toBe(second);
    expect(first[SECTION]).not.toBe(adminEn[SECTION]);
  });
});
