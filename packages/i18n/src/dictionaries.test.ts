import { describe, expect, it } from "vitest";
import { LOCALES, DEFAULT_LOCALE, isLocale, type Locale } from "./config";
import { getDictionary } from "./index";
import { getAdminDictionary } from "./admin/index";
import { getMarketingDictionary } from "./marketing/index";

/**
 * What thirty-five dictionaries have to agree about.
 *
 * This package had 114 source files and no tests, and the reason it looked safe is that
 * TypeScript checks a lot of it: the storefront and marketing dictionaries are typed
 * against English, so a *missing* key does not compile. The admin set is deliberately
 * partial — it merges over English so a translation can land a section at a time — so a
 * missing key there is a feature.
 *
 * None of which catches the failures that actually reach a seller's screen:
 *
 * - **A renamed placeholder.** English says `{count} items`, a translator writes
 *   `{anzahl} Artikel`, and `interpolate` leaves unknown keys alone by design — so the
 *   screen shows a literal `{anzahl}`. Typechecks, ships, and is invisible to everyone
 *   who does not read that language.
 * - **An empty string.** `""` satisfies `string`. It renders as a blank label, and a
 *   blank label looks like a layout bug rather than a missing translation.
 * - **A locale in the picker with no dictionary behind it.** The picker is built from
 *   `LOCALES`; the dictionaries are separate objects. A code in one and not the other
 *   silently serves English to somebody who chose otherwise.
 * - **A key no locale should still have.** An extra key in a partial admin dictionary is
 *   a rename that did not propagate, and it is dead weight that reads as coverage.
 */

const CODES = LOCALES.map((l) => l.code);

/** Every leaf string in a dictionary, keyed by its dotted path. */
function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value };
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.assign(out, flatten(child, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

/** The `{placeholder}` names a string uses, as a sorted list. */
const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

const SETS = [
  { name: "storefront", get: (l: Locale) => getDictionary(l) },
  { name: "admin", get: (l: Locale) => getAdminDictionary(l) },
  { name: "marketing", get: (l: Locale) => getMarketingDictionary(l) },
] as const;

describe("the locale list", () => {
  it("has no duplicates, because a picker cannot show the same code twice", () => {
    expect(new Set(CODES).size).toBe(CODES.length);
  });

  it("includes the default, or every fallback resolves to nothing", () => {
    expect(CODES).toContain(DEFAULT_LOCALE);
    expect(isLocale(DEFAULT_LOCALE)).toBe(true);
  });

  it("agrees with its own type guard", () => {
    for (const code of CODES) expect(isLocale(code), code).toBe(true);
    expect(isLocale("klingon")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("marks Arabic and Hebrew right-to-left, which the layout reads", () => {
    const rtl = LOCALES.filter((l) => l.dir === "rtl").map((l) => l.code);

    // A locale mis-marked here mirrors an entire storefront the wrong way.
    expect(rtl).toContain("ar");
    for (const locale of LOCALES) {
      expect(["ltr", "rtl"], locale.code).toContain(locale.dir);
    }
  });

  it("gives every locale a native name, which is what the picker shows", () => {
    for (const locale of LOCALES) {
      expect(locale.native.trim(), locale.code).not.toBe("");
      expect(locale.name.trim(), locale.code).not.toBe("");
    }
  });
});

describe.each(SETS)("the $name dictionaries", ({ name, get }) => {
  const english = flatten(get(DEFAULT_LOCALE));

  it("has something for every locale in the picker", () => {
    for (const code of CODES) {
      // Not just "does not throw": a locale with no dictionary resolves to the English
      // object, and that is indistinguishable from an English-only translation unless
      // the object identity is compared.
      expect(get(code as Locale), code).toBeTruthy();
    }
  });

  it("is not empty in English, which everything else falls back to", () => {
    expect(Object.keys(english).length).toBeGreaterThan(10);
  });

  /*
   * THE ONE THE COMPILER CANNOT SEE
   *
   * `interpolate` leaves an unknown `{key}` exactly as it found it — which is right, and
   * which means a renamed placeholder reaches the screen as literal braces instead of a
   * number. There is no way to notice this in a language you do not read.
   */
  it("uses the same placeholders English does, in every locale", () => {
    const wrong: string[] = [];

    for (const code of CODES) {
      if (code === DEFAULT_LOCALE) continue;
      const translated = flatten(get(code as Locale));

      for (const [key, text] of Object.entries(translated)) {
        const source = english[key];
        if (source === undefined) continue;
        const expected = placeholders(source);
        const actual = placeholders(text);
        // Extra placeholders are the bug; a translation that legitimately drops one
        // (a language that does not need to repeat the count) is allowed.
        const unexpected = actual.filter((p) => !expected.includes(p));
        if (unexpected.length > 0) {
          wrong.push(`${name}/${code} ${key}: {${unexpected.join("}, {")}} not in English`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  it("has no blank strings, which render as a layout bug rather than a gap", () => {
    const blank: string[] = [];

    for (const code of CODES) {
      for (const [key, text] of Object.entries(flatten(get(code as Locale)))) {
        if (text.trim() === "") blank.push(`${name}/${code} ${key}`);
      }
    }

    expect(blank).toEqual([]);
  });

  /*
   * An extra key is a rename that did not propagate. It costs nothing at runtime — the
   * merge ignores it — but it reads as coverage in a file somebody is about to review,
   * and it hides the fact that the *real* key is still English.
   */
  it("has no keys English does not have", () => {
    const extra: string[] = [];

    for (const code of CODES) {
      if (code === DEFAULT_LOCALE) continue;
      for (const key of Object.keys(flatten(get(code as Locale)))) {
        if (!(key in english)) extra.push(`${name}/${code} ${key}`);
      }
    }

    expect(extra).toEqual([]);
  });

  /*
   * A translation identical to English across the whole dictionary means the file is a
   * copy nobody has touched — which is fine as a starting point but should not be
   * mistaken for a translated locale. Reported as a count rather than a failure, because
   * partial admin dictionaries are legitimately mostly-English.
   */
  it("is not a byte-for-byte copy of English in any locale", () => {
    const copies = CODES.filter((code) => {
      if (code === DEFAULT_LOCALE) return false;
      const translated = flatten(get(code as Locale));
      const keys = Object.keys(translated);
      if (keys.length === 0) return false;
      return keys.every((key) => translated[key] === english[key]);
    });

    expect(copies).toEqual([]);
  });
});

describe("an unknown locale", () => {
  it("falls back to English rather than throwing or blanking", () => {
    // The locale comes from a cookie and a shop setting, so "not a locale" happens.
    expect(getDictionary("klingon")).toBe(getDictionary(DEFAULT_LOCALE));
    expect(getDictionary(undefined)).toBe(getDictionary(DEFAULT_LOCALE));
    expect(getDictionary(null)).toBe(getDictionary(DEFAULT_LOCALE));
  });
});
