import { DEFAULT_LOCALE, type Locale } from "@sailo/i18n/config";
import { getContentLocales } from "@/lib/blog";
import { absolute } from "@sailo/core/origin";

/**
 * The public shape of every blog URL, in one place.
 *
 * This used to be written out five times — twice as helpers in the route
 * files, three times as template literals in the list and the sitemap. That is
 * survivable for a link, but not for SEO: a canonical, an `hreflang` entry and
 * a sitemap `<loc>` describing the same page have to be byte-identical or they
 * argue with each other, and a crawler resolves that argument by trusting none
 * of them. One builder means they cannot drift.
 *
 * These are the *public* paths — the ones with the locale in front. The routes
 * themselves live at `/blog/<locale>/…`; `src/proxy.ts` rewrites between the
 * two. Nothing outside the proxy should ever build the internal shape.
 */

/** `/fr/blog`, or `/fr/blog/page/2` beyond the first. */
export function blogIndexPath(locale: Locale, page = 1): string {
  // Page one is `/fr/blog`, never `/fr/blog/page/1`: one page, one URL.
  return page <= 1 ? `/${locale}/blog` : `/${locale}/blog/page/${page}`;
}

/** `/fr/blog/comment-fixer-ses-prix`. */
export function articlePath(locale: Locale, slug: string): string {
  return `/${locale}/blog/${slug}`;
}

/**
 * The `hreflang` cluster for the blog's front page.
 *
 * Every language's index is the same page — the blog's door — in a different
 * language, so they are genuine alternates of one another and each should tell
 * a crawler where the other 34 are. Without this Google indexes 35 unconnected
 * pages, picks whichever it likes for a given searcher, and a French reader
 * gets the English one. That is the machine-readable half of the language
 * problem the locale prefix solved for humans.
 *
 * Only locales that actually have articles on disk are listed. Pointing at an
 * empty index would be sending a reader somewhere with nothing to read, and
 * that page is `noindex` anyway.
 *
 * `x-default` is the fallback for a language we do not publish in. English,
 * because that is what `/blog` itself falls back to.
 */
export async function blogIndexLanguages(): Promise<Record<string, string>> {
  const locales = await getContentLocales();

  return {
    ...Object.fromEntries(
      locales.map((locale) => [locale, absolute(blogIndexPath(locale))]),
    ),
    ...(locales.includes(DEFAULT_LOCALE)
      ? { "x-default": absolute(blogIndexPath(DEFAULT_LOCALE)) }
      : {}),
  };
}
