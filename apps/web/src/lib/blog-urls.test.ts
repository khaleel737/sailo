import { describe, expect, it } from "vitest";
import { articlePath, blogIndexLanguages, blogIndexPath } from "./blog-urls";
import { getContentLocales, getEveryArticleByLocale } from "./blog";
import { DEFAULT_LOCALE } from "@/i18n/config";

/*
 * These read the real `content/blog` directory, like `blog.test.ts` does, and
 * for the same reason: the thing worth proving is not that a builder can
 * concatenate strings, it is that the URLs the site actually publishes are the
 * ones the canonicals, the `hreflang` cluster and the sitemap all agree on.
 * A fixture would prove none of that.
 */

describe("blogIndexPath", () => {
  it("puts the locale in front, where a crawler can see it", () => {
    expect(blogIndexPath("fr")).toBe("/fr/blog");
  });

  it("gives page one exactly one URL", () => {
    // `/fr/blog/page/1` would be a second address for a page that already has
    // one, which is the duplicate the canonical exists to prevent.
    expect(blogIndexPath("fr", 1)).toBe("/fr/blog");
    expect(blogIndexPath("fr")).toBe(blogIndexPath("fr", 1));
  });

  it("numbers the pages after the first", () => {
    expect(blogIndexPath("fr", 2)).toBe("/fr/blog/page/2");
  });

  it("treats a page below one as the first", () => {
    expect(blogIndexPath("fr", 0)).toBe("/fr/blog");
    expect(blogIndexPath("fr", -3)).toBe("/fr/blog");
  });
});

describe("articlePath", () => {
  it("nests the slug under the locale's blog", () => {
    expect(articlePath("it", "come-fare-i-prezzi")).toBe(
      "/it/blog/come-fare-i-prezzi",
    );
  });

  it("never collides with the paginated index", async () => {
    /*
     * `page` is a literal segment in the route tree, so an article slugged
     * "page" would sit at `/en/blog/page` and shadow the pager. The registry
     * test in `blog.test.ts` refuses such a slug; this is the URL-shaped half
     * of the same guarantee.
     */
    for (const { locale, article } of await getEveryArticleByLocale()) {
      expect(articlePath(locale, article.slug)).not.toBe(
        `${blogIndexPath(locale)}/page`,
      );
    }
  });
});

describe("blogIndexLanguages", () => {
  it("names every language that has articles, and no others", async () => {
    const languages = await blogIndexLanguages();
    const locales = await getContentLocales();

    // Anything extra would be an `hreflang` pointing at an index with nothing
    // on it, which `generateMetadata` marks `noindex`.
    const named = Object.keys(languages).filter((key) => key !== "x-default");
    expect(named.toSorted()).toEqual([...locales].toSorted());
  });

  it("emits absolute URLs, which is the only shape hreflang accepts", async () => {
    for (const [key, url] of Object.entries(await blogIndexLanguages())) {
      expect(url, key).toMatch(/^https?:\/\//);
    }
  });

  it("falls back to English for a language we do not publish in", async () => {
    const languages = await blogIndexLanguages();
    expect(languages["x-default"]).toBe(languages[DEFAULT_LOCALE]);
  });

  it("agrees with the canonical each index declares", async () => {
    /*
     * The failure this catches is the quiet one: a cluster whose entry for a
     * locale is not byte-identical to that page's own canonical. Google
     * resolves that disagreement by ignoring the `hreflang` for the whole
     * cluster, so all 35 pages lose it at once.
     */
    const languages = await blogIndexLanguages();
    for (const locale of await getContentLocales()) {
      const href = languages[locale];
      if (!href) throw new Error(`no hreflang for ${locale}`);
      expect(new URL(href).pathname).toBe(blogIndexPath(locale));
    }
  });
});
