import { describe, expect, it } from "vitest";
import { blocksBuild, flatten, gapsFor } from "./gaps";
import {
  PROTECTED_SECTIONS,
  assertSectionsExist,
  glossaryFor,
  isProtected,
} from "./glossary";
import { en } from "../dictionaries/en";
import { adminEn } from "../admin/en";

/**
 * The reporting half of the translation pipeline.
 *
 * Two things here are load-bearing beyond the arithmetic. `flatten` refuses a
 * shape it does not understand rather than skipping it, because a dictionary
 * that grew a third level would otherwise be *half* translated and report itself
 * complete. And `assertSectionsExist` runs against the real English
 * dictionaries, so renaming a money section to something the glossary does not
 * name fails here rather than quietly unprotecting it.
 */

describe("flatten", () => {
  it("produces section.key for every leaf", () => {
    expect(
      flatten({ errors: { title: "Oops", retry: "Try again" } }, "storefront"),
    ).toEqual({ "errors.title": "Oops", "errors.retry": "Try again" });
  });

  it("refuses a third level rather than skipping it", () => {
    /*
     * The failure that matters. Silently ignoring a nested object means every
     * string under it is invisible to the gap report, so 34 locales are missing
     * them and the tool says everything is fine.
     */
    expect(() =>
      flatten({ nav: { menu: { home: "Home" } } }, "storefront"),
    ).toThrow(/not a string/);
  });

  it("refuses an array, which reads as an object and is not one", () => {
    expect(() => flatten({ plans: ["free", "pro"] }, "admin")).toThrow(/an array/);
  });

  it("names the surface and the path, so the message is actionable", () => {
    expect(() => flatten({ a: "x" }, "admin")).toThrow(/admin: section "a"/);
  });
});

describe("gapsFor", () => {
  const source = { "a.one": "One", "a.two": "Two", "b.three": "Three" };

  it("finds what a locale has not got", () => {
    const gap = gapsFor(source, { "a.one": "Eins" }, "de");
    expect(gap.missing).toEqual(["a.two", "b.three"]);
  });

  it("reports a key English no longer has, without counting it as debt", () => {
    /*
     * Dead weight from a key that was removed upstream. Translating cannot fix
     * it and it must not inflate the number somebody is working down.
     */
    const gap = gapsFor(source, { ...source, "a.gone": "Weg" }, "de");
    expect(gap.orphaned).toEqual(["a.gone"]);
    expect(gap.missing).toEqual([]);
  });

  it("flags a value that is still the English one", () => {
    /*
     * The one signal that catches a locale filled by copying English in, which
     * passes every other check here. A hint, never a failure — "OK" and "Email"
     * are correct in a dozen languages.
     */
    const gap = gapsFor(
      source,
      { "a.one": "One", "a.two": "Zwei", "b.three": "Drei" },
      "de",
    );
    expect(gap.untranslated).toEqual(["a.one"]);
  });

  it("is empty for a complete locale", () => {
    const gap = gapsFor(source, { "a.one": "Eins", "a.two": "Zwei", "b.three": "Drei" }, "de");
    expect(gap).toEqual({ locale: "de", missing: [], orphaned: [], untranslated: [] });
  });
});

describe("what fails a build and what does not", () => {
  /*
   * The whole reason the two surfaces are reported differently. Storefront
   * dictionaries are typed as the complete `Dictionary`, so a hole is a compile
   * error. Admin dictionaries are partial and merged over English at runtime, so
   * a hole is a Hungarian seller reading one English label.
   */
  const gap = { locale: "de", missing: ["a.one"], orphaned: [], untranslated: [] };

  it("fails on a storefront hole", () => {
    expect(blocksBuild("storefront", gap)).toBe(true);
  });

  it("does not fail on an admin hole", () => {
    expect(blocksBuild("admin", gap)).toBe(false);
  });
});

describe("the glossary", () => {
  it("protects every money section it names, in both real dictionaries", () => {
    /*
     * Against the actual English, not a fixture. A money section renamed without
     * updating this list would leave the protection covering nothing while every
     * other check still passed.
     */
    expect(() =>
      assertSectionsExist("storefront", Object.keys(en)),
    ).not.toThrow();
    expect(() =>
      assertSectionsExist("admin", Object.keys(adminEn)),
    ).not.toThrow();
    expect(PROTECTED_SECTIONS.storefront!.length).toBeGreaterThan(0);
    expect(PROTECTED_SECTIONS.admin!.length).toBeGreaterThan(0);
  });

  it("says so when a protected section has been renamed away", () => {
    expect(() => assertSectionsExist("storefront", ["basket"])).toThrow(
      /are protected but do not exist/,
    );
  });

  it("keeps a filler out of a protected section entirely", () => {
    expect(isProtected("storefront", "checkout.payNow")).toBe(true);
    expect(isProtected("storefront", "footer.about")).toBe(false);
    expect(isProtected("admin", "payouts.balance")).toBe(true);
  });

  it("attaches only the terms a string actually uses", () => {
    expect(Object.keys(glossaryFor("Request a refund"))).toEqual(["refund"]);
    expect(glossaryFor("Choose a plan")).toEqual({});
  });

  it("matches whole words, so a longer word does not drag a term in", () => {
    // "Repriced" contains "price" and is not about one.
    expect(glossaryFor("Repriced yesterday")).toEqual({});
    expect(Object.keys(glossaryFor("The price shown"))).toEqual(["price"]);
  });
});
