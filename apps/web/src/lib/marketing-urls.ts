import { DEFAULT_LOCALE, LOCALES, type Locale } from "@sailo/i18n/config";
import { absolute } from "@/lib/seo";

/**
 * The public shape of every marketing URL, in one place.
 *
 * The same job `blog-urls.ts` does for the blog, for the two pages that
 * actually sell. It exists for the same reason: a canonical, an `hreflang`
 * entry and a sitemap `<loc>` describing one page have to be byte-identical or
 * a crawler resolves the disagreement by trusting none of them.
 *
 * These are the *public* paths. The routes themselves live under
 * `/home/<locale>/…`, because `[handle]` already owns the root dynamic segment
 * and Next allows one dynamic name per position; `src/proxy.ts` rewrites
 * between the two. Nothing outside the proxy should build the internal shape.
 *
 * Safe against shop handles by the same argument the blog relies on:
 * `HANDLE_MIN` is 3 and every locale code but `fil` is two characters, so 34 of
 * them can never be a handle. `fil` and `home` are both in `RESERVED_HANDLES`.
 */

/**
 * English lives at the bare path, not at `/en`.
 *
 * `/` is the root of the domain and the page every external link points at, so
 * it has to be the English page rather than a redirect to one — a 307 on the
 * most-linked URL on the site spends authority for nothing. The other 34
 * languages hang off it, and `src/proxy.ts` sends `/en` here with a 308 so the
 * page still only ever has one address.
 */
export function homePath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "/" : `/${locale}`;
}

export function pricingPath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "/pricing" : `/${locale}/pricing`;
}

/**
 * The `hreflang` cluster for one marketing page.
 *
 * Unlike the blog — which is written per market, so most articles genuinely
 * have no alternates — the landing page and the pricing page are the same page
 * in 35 languages. Every one of them is a true alternate of the other 34, so
 * the full cluster is correct here rather than an overclaim.
 *
 * Without it, Google indexes whichever single version it crawled first and
 * serves that one to everybody: 34 languages of the highest-value copy on the
 * site, written and paid for, that no search engine can offer to the reader it
 * was written for.
 *
 * `x-default` is the English page, which is also what an unmatched
 * `Accept-Language` falls back to — so the declaration and the behaviour agree.
 */
/**
 * The absolute form of a public path, normalised the way Next normalises a
 * canonical.
 *
 * `absolute("/")` yields a trailing slash, and Next's metadata layer strips it
 * when it renders `<link rel="canonical">`. Left alone, that put
 * `https://sailo.store` in the page head and `https://sailo.store/` in the
 * sitemap for the same URL. The two are equivalent under RFC 3986 and Google
 * normalises them, so nothing was breaking — but this file exists so that a
 * canonical, an alternate and a `<loc>` are the *same string*, and an exception
 * nobody wrote down is how that guarantee quietly stops being true.
 */
export function marketingUrl(path: string): string {
  return absolute(path).replace(/\/$/, "");
}

function cluster(build: (locale: Locale) => string): Record<string, string> {
  return {
    ...Object.fromEntries(
      LOCALES.map(({ code }) => [code, marketingUrl(build(code))]),
    ),
    "x-default": marketingUrl(build(DEFAULT_LOCALE)),
  };
}

export const homeLanguages = (): Record<string, string> => cluster(homePath);
export const pricingLanguages = (): Record<string, string> => cluster(pricingPath);

/**
 * The 34 locales that get a prefixed route. English is excluded because it is
 * served from `/` and `/pricing` directly — generating it here as well would
 * build a second copy of each page at `/en` and `/en/pricing`.
 */
export const PREFIXED_LOCALES = LOCALES.filter(
  ({ code }) => code !== DEFAULT_LOCALE,
).map(({ code }) => code);
