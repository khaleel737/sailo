import { describe, expect, it } from "vitest";
import { config } from "./proxy";
import { LOCALES } from "./i18n/config";

/*
 * The proxy's matcher has to be a static literal — Next reads it at build time
 * and refuses an expression — so the locale list is written out by hand there
 * and duplicated from `i18n/config`.
 *
 * Duplication that no one checks is duplication that drifts. Ship a
 * thirty-sixth language, forget this file, and its blog silently 404s while
 * every other language works, which is the kind of fault nobody finds for
 * months. These tests are the check.
 */

const all = Array.isArray(config.matcher) ? config.matcher : [config.matcher];

function codesIn(matcher: string): string[] {
  const group = matcher.match(/\(([a-z|]+)\)/)?.[1];
  return group ? group.split("|") : [];
}

/*
 * Only the entries that carry a locale group are judged against the locale
 * list. The bare `/blog` entry and the `/` one do not, and naming them here
 * individually would mean this test had to be edited every time the proxy took
 * on another job — which is the moment it stops being run.
 */
const matchers = all.filter((m) => codesIn(m).length > 0);

describe("the proxy matcher", () => {
  it("covers exactly the locales the site ships", () => {
    const shipped = LOCALES.map((l) => l.code).toSorted();

    for (const matcher of matchers) {
      expect(codesIn(matcher).toSorted(), matcher).toEqual(shipped);
    }
  });

  it("still catches bare /blog, which redirects to a language", () => {
    expect(all).toContain("/blog");
  });

  it("catches the landing page, where a signed-in seller is redirected", () => {
    /*
     * It has to be answered before anything is sent. The page sits behind
     * `(marketing)/loading.tsx`, so a `redirect()` from inside it arrives after
     * the shell has streamed — the seller sees the splash, then the header and
     * footer around an empty page, and only then the hop to /admin.
     */
    expect(all).toContain("/");
  });

  it("matches both the index and the paths beneath it", () => {
    // `/fr/blog` and `/fr/blog/slug` are different shapes, and a matcher that
    // only caught the second would leave every locale index unreachable.
    expect(matchers.some((m) => m.endsWith("/blog"))).toBe(true);
    expect(matchers.some((m) => m.endsWith("/blog/:path*"))).toBe(true);
  });

  it("puts three-letter codes ahead of the two-letter code they start with", () => {
    // `fi|fil` would let `fi` claim the first two characters of `/fil/blog`.
    for (const matcher of matchers) {
      const codes = codesIn(matcher);
      for (const code of codes) {
        const shadowed = codes.filter((c) => c.length > code.length && c.startsWith(code));
        for (const longer of shadowed) {
          expect(
            codes.indexOf(longer),
            `${longer} must come before ${code} in the alternation`,
          ).toBeLessThan(codes.indexOf(code));
        }
      }
    }
  });
});
