"use server";

import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { getContentLocales, getSlugLocales } from "@/lib/blog";
import { articlePath, blogIndexPath } from "@/lib/blog-urls";

/**
 * Persists a visitor's language choice. Server-side rather than
 * `document.cookie` so the very next render already sees it — writing from the
 * client races the refresh and the page comes back in the old language.
 */
export async function setLocale(
  code: string,
  /** Where the visitor is now, so a locale-prefixed URL can be rewritten. */
  pathname?: string,
): Promise<string | null> {
  // Narrowed here rather than asserted: the code arrives from a client call,
  // so it is a claim until this line checks it against the shipped list.
  const locale: Locale = LOCALES.find((l) => l.code === code)?.code ?? DEFAULT_LOCALE;

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    /*
     * It holds a language code and nothing else, so this is tidiness rather
     * than a fix — but a cookie with no `secure` is a cookie an attacker on
     * the network can set, and there is no reason to leave one lying around.
     * Off in development, where there is no TLS to be secure over.
     */
    secure: process.env.NODE_ENV === "production",
  });

  /*
   * No `revalidatePath("/", "layout")` here, and that is deliberate.
   *
   * It used to purge the entire prerendered route tree, from an action that is
   * unauthenticated, unthrottled, and — being called by a `"use client"`
   * component — has its id in the public bundle. A `curl` loop at a few
   * requests a second made every storefront, marketing page and blog article
   * re-render for the next visitor, indefinitely, for nothing.
   *
   * It was also doing no work. Its comment claimed "every page reads the
   * cookie, so the whole tree is stale" — but a page that reads the cookie
   * reads it through `cookies()`, which puts it in the dynamic hole and out of
   * the prerender, so there was never a cached copy of it to invalidate. The
   * static shell that *is* cached contains nothing locale-dependent, which is
   * the whole point of taking the cookie off `<html>`. And every cached
   * function that varies by language — all of `lib/blog.ts` — takes the locale
   * as an argument, so it is in the cache key already.
   *
   * The caller's `router.refresh()` re-renders the dynamic parts against the
   * cookie set above, which is all that was ever needed.
   */
  return blogHrefFor(locale, pathname);
}

/**
 * Where a reader on a locale-prefixed URL should land after switching.
 *
 * The blog is the one place the cookie is not the answer. Its routes read the
 * locale out of the *path* on purpose — `/fr/blog` has to be a French page a
 * crawler can rank as French, which one cookie-switched `/blog` never could
 * be — so refreshing the same URL changed the chrome around the article and
 * left the article itself in the language it was already in. Nav in French,
 * posts in English, address bar still saying `/en`.
 *
 * Null means the caller should just refresh, which is right everywhere else.
 */
export async function blogHrefFor(
  locale: Locale,
  pathname: string | undefined,
): Promise<string | null> {
  if (!pathname) return null;

  const codes = LOCALES.map((l) => l.code).join("|");
  const match = new RegExp(`^/(?:${codes})/blog(?:/(.*))?$`).exec(pathname);
  if (!match) return null;

  // The blog is written per market rather than translated, so a language may
  // simply have no version of this page. Its index is the honest fallback:
  // the reader asked for French and gets French, rather than an English
  // article wearing French chrome.
  const index = blogIndexPath(locale);
  if (!(await getContentLocales()).includes(locale)) return index;

  const rest = match[1] ?? "";
  // Paged indexes carry no article, so they only need the language swapped.
  if (!rest || rest.startsWith("page/")) return `${index}${rest ? `/${rest}` : ""}`;

  const slug = rest.split("/")[0] ?? "";
  return (await getSlugLocales(slug)).includes(locale)
    ? articlePath(locale, slug)
    : index;
}
