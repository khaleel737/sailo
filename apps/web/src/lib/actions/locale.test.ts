import { describe, expect, it, vi } from "vitest";

/*
 * The blog is the one surface whose language lives in the URL rather than in
 * the cookie, so it is the one surface where switching language has to
 * navigate. `getContentLocales` and `getSlugLocales` read the filesystem, so
 * they are stubbed: what is under test is the routing decision, not the disk.
 */
vi.mock("@/lib/blog", () => ({
  getContentLocales: async () => ["en", "fr", "de"],
  // "hello" exists in English and French; "solo" only in English.
  getSlugLocales: async (slug: string) =>
    slug === "hello" ? ["en", "fr"] : ["en"],
}));

const { blogHrefFor } = await import("@/lib/actions/locale");

describe("blogHrefFor", () => {
  it("leaves every non-blog path alone, so the cookie still decides", () => {
    // The storefront, admin and marketing pages all read the cookie, and a
    // navigation there would throw away whatever the visitor was doing.
    for (const path of ["/", "/demo", "/admin/orders", "/pricing", undefined]) {
      expect(blogHrefFor("fr", path)).resolves.toBeNull();
    }
  });

  it("swaps the language on the blog index", async () => {
    expect(await blogHrefFor("fr", "/en/blog")).toBe("/fr/blog");
  });

  it("keeps the reader on the same article when it exists in that language", async () => {
    expect(await blogHrefFor("fr", "/en/blog/hello")).toBe("/fr/blog/hello");
  });

  it("falls back to the index when the article has no such translation", async () => {
    /*
     * The blog is written per market rather than translated, so this is the
     * ordinary case, not an error. They asked for French and get French —
     * better than a French header wrapped around an English article.
     */
    expect(await blogHrefFor("fr", "/en/blog/solo")).toBe("/fr/blog");
  });

  it("falls back to the index for a language with no blog at all", async () => {
    expect(await blogHrefFor("ja", "/en/blog/hello")).toBe("/ja/blog");
  });

  it("keeps the page number when swapping a paged index", async () => {
    // A paged index carries no article, so only the language changes.
    expect(await blogHrefFor("fr", "/en/blog/page/3")).toBe("/fr/blog/page/3");
  });

  it("switching to the language already in the path is a no-op navigation", async () => {
    expect(await blogHrefFor("en", "/en/blog/hello")).toBe("/en/blog/hello");
  });

  it("ignores a path that merely looks like a locale prefix", async () => {
    // `/english/blog` is a shop called "english", not a locale-prefixed URL.
    expect(await blogHrefFor("fr", "/english/blog")).toBeNull();
    expect(await blogHrefFor("fr", "/blog")).toBeNull();
  });
});
