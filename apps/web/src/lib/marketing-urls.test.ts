import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES } from "@sailo/i18n/config";
import {
  PREFIXED_LOCALES,
  homeLanguages,
  homePath,
  marketingUrl,
  pricingLanguages,
  pricingPath,
} from "./marketing-urls";

/*
 * The canonical, the `hreflang` alternate and the sitemap `<loc>` for one page
 * have to be the same string. They are built from these helpers precisely so
 * they cannot drift — these tests are what make that guarantee real rather than
 * a comment.
 *
 * The failure mode is quiet and expensive: Google's response to a cluster whose
 * members disagree is to drop `hreflang` for the whole site, not to fix it up.
 */

const codes = LOCALES.map((l) => l.code);

describe("marketing URLs", () => {
  it("serves English from the bare path, not from /en", () => {
    // `/` is the root of the domain and the URL every external link points at.
    // A second copy at `/en` would compete with it for its own terms.
    expect(homePath(DEFAULT_LOCALE)).toBe("/");
    expect(pricingPath(DEFAULT_LOCALE)).toBe("/pricing");
  });

  it("prefixes every other language", () => {
    expect(homePath("fr")).toBe("/fr");
    expect(pricingPath("fr")).toBe("/fr/pricing");
  });

  it("never generates a prefixed route for the default locale", () => {
    // `generateStaticParams` reads this. Including English would build the
    // homepage twice, at `/` and at `/en`.
    expect(PREFIXED_LOCALES).not.toContain(DEFAULT_LOCALE);
    expect(PREFIXED_LOCALES).toHaveLength(codes.length - 1);
  });

  it.each([
    ["home", homeLanguages, homePath],
    ["pricing", pricingLanguages, pricingPath],
  ] as const)("names every shipped language in the %s cluster", (_name, languages, path) => {
    const cluster = languages();

    // Every locale, and x-default on top — a cluster missing one language is
    // that language's page indexed as an orphan.
    expect(Object.keys(cluster).toSorted()).toEqual(
      [...codes, "x-default"].toSorted(),
    );

    // Each entry is the absolute form of the same path the page canonicalises
    // to. This is the equality the whole file exists to hold.
    for (const code of codes) {
      expect(cluster[code], code).toBe(marketingUrl(path(code)));
    }
  });

  it.each([
    ["home", homeLanguages, homePath],
    ["pricing", pricingLanguages, pricingPath],
  ] as const)("points x-default at English in the %s cluster", (_name, languages, path) => {
    // The fallback for a language we do not publish in, and the same page an
    // unmatched Accept-Language already falls back to — so the declaration and
    // the behaviour agree.
    expect(languages()["x-default"]).toBe(languages()[DEFAULT_LOCALE]);
    expect(languages()["x-default"]).toBe(marketingUrl(path(DEFAULT_LOCALE)));
  });

  it("is absolute everywhere, because hreflang requires it", () => {
    for (const url of Object.values(homeLanguages())) {
      expect(url).toMatch(/^https?:\/\//);
    }
  });
});
