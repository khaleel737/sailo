import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

/**
 * Slugs, which are URLs.
 *
 * Split out of `money/currency-parsing.test.ts`, which tested six modules across
 * three folders under a name that named one of them. A slug has nothing to do
 * with money; it was there because both were once in `apps/web/src/lib/utils.ts`.
 */

describe("slugify", () => {
  it("makes a URL-safe handle out of a title", () => {
    expect(slugify("Speckled Mug")).toBe("speckled-mug");
  });

  it("collapses punctuation and spacing rather than leaving it in a path", () => {
    expect(slugify("  Tea & Coffee!!  ")).toBe("tea-coffee");
  });

  it("never produces a leading or trailing dash", () => {
    // "/shop/-mug-" is a different URL from "/shop/mug".
    expect(slugify("!Mug!")).toBe("mug");
    expect(slugify("--mug--")).toBe("mug");
  });

  it("returns something for a title with nothing safe in it", () => {
    // An empty slug would make a product unreachable at any URL.
    expect(slugify("!!!")).toBeTruthy();
  });
});
