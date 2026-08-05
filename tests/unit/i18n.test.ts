import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  directionOf,
  isLocale,
  matchAcceptLanguage,
} from "@/i18n/config";
import { getDictionary, interpolate, plural } from "@/i18n";
import { en } from "@/i18n/dictionaries/en";

/** Every leaf key path in the source dictionary. */
function leafPaths(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "string"
      ? [`${prefix}${k}`]
      : leafPaths(v as object, `${prefix}${k}.`),
  );
}

function at(obj: object, path: string): string {
  return path
    .split(".")
    .reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], obj) as string;
}

const EN_PATHS = leafPaths(en).sort();

describe("locales", () => {
  it("ships 22", () => {
    expect(LOCALES).toHaveLength(22);
  });

  it("has no duplicates", () => {
    expect(new Set(LOCALES.map((l) => l.code)).size).toBe(LOCALES.length);
  });

  it("marks Arabic as the only right-to-left one", () => {
    expect(LOCALES.filter((l) => l.dir === "rtl").map((l) => l.code)).toEqual(["ar"]);
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
  });

  it("gives every locale a native name", () => {
    for (const l of LOCALES) expect(l.native.trim()).toBeTruthy();
  });
});

describe("dictionaries", () => {
  it.each(LOCALES.map((l) => l.code))("%s has exactly the English keys", (code) => {
    // A missing key is a compile error, but an *extra* one is a leftover from
    // a rename that nothing will ever read.
    expect(leafPaths(getDictionary(code)).sort()).toEqual(EN_PATHS);
  });

  it.each(LOCALES.map((l) => l.code))("%s has no blank strings", (code) => {
    const dict = getDictionary(code) as unknown as object;
    const blanks = EN_PATHS.filter((p) => !at(dict, p).trim());
    expect(blanks).toEqual([]);
  });

  it.each(LOCALES.map((l) => l.code))("%s keeps every placeholder", (code) => {
    // A dropped `{amount}` renders as a sentence with a hole in it; an invented
    // one renders the literal braces to the buyer.
    const dict = getDictionary(code) as unknown as object;
    const wrong = EN_PATHS.filter((p) => {
      const want = [...at(en, p).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const got = [...at(dict, p).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      return want.join() !== got.join();
    });
    expect(wrong).toEqual([]);
  });

  it.each([
    ["ja", /[ぁ-んァ-ン一-龯]/],
    ["ar", /[؀-ۿ]/],
    ["zh", /[一-鿿]/],
    ["ru", /[Ѐ-ӿ]/],
    ["el", /[Ͱ-Ͽ]/],
  ] as const)("%s is actually written in its own script", (code, script) => {
    expect(getDictionary(code).shop.searchPlaceholder).toMatch(script);
  });

  it("is not still English under a different name", () => {
    const enValues = EN_PATHS.map((p) => at(en, p));
    for (const l of LOCALES) {
      if (l.code === "en") continue;
      const dict = getDictionary(l.code) as unknown as object;
      const same = EN_PATHS.filter((p, i) => at(dict, p) === enValues[i]);
      // Brand names and a few symbols legitimately match.
      expect(same.length).toBeLessThan(25);
    }
  });

  it("falls back to English for anything unknown", () => {
    expect(getDictionary("klingon")).toBe(getDictionary(DEFAULT_LOCALE));
    expect(getDictionary(null)).toBe(getDictionary(DEFAULT_LOCALE));
  });
});

describe("matchAcceptLanguage", () => {
  it("picks the highest q-value", () => {
    expect(matchAcceptLanguage("en;q=0.3,ja;q=0.9")).toBe("ja");
  });

  it("reads a plain ordered list", () => {
    expect(matchAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
  });

  it("falls back from a region to its base language", () => {
    expect(matchAcceptLanguage("zh-CN")).toBe("zh");
  });

  it.each([[null], [""], ["xx-YY"], ["*"]])("returns null for %s", (header) => {
    expect(matchAcceptLanguage(header)).toBeNull();
  });

  it("only ever returns a locale we ship", () => {
    const got = matchAcceptLanguage("de-AT,de;q=0.9");
    expect(got && isLocale(got)).toBe(true);
  });
});

describe("interpolate", () => {
  it("substitutes every placeholder", () => {
    expect(interpolate("Earn {percent}% at {shop}", { percent: "10", shop: "Clay" })).toBe(
      "Earn 10% at Clay",
    );
  });

  it("leaves an unknown placeholder alone rather than printing undefined", () => {
    expect(interpolate("Hi {name}", {})).toBe("Hi {name}");
  });

  it("substitutes a placeholder used twice", () => {
    expect(interpolate("{a} and {a}", { a: "x" })).toBe("x and x");
  });
});

describe("plural", () => {
  it("picks the singular for one", () => {
    expect(plural(1, "{count} item", "{count} items")).toBe("1 item");
  });

  it.each([[0], [2], [11]])("picks the plural for %i", (n) => {
    expect(plural(n, "{count} item", "{count} items")).toBe(`${n} items`);
  });
});
