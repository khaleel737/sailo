"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
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
  });

  // Every page reads the cookie, so the whole tree is stale.
  revalidatePath("/", "layout");

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
