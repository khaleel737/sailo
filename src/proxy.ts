import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  LOCALES,
  matchAcceptLanguage,
} from "@/i18n/config";

/*
 * Locale-prefixed blog URLs.
 *
 * The blog is written per market rather than translated, so each language needs
 * its own indexable URL: `/fr/blog/...` is a French page a crawler can rank as
 * French, where one cookie-switched `/blog/...` never could be.
 *
 * The app cannot hold a top-level `[locale]` segment, because `[handle]` is
 * already there serving shops and Next allows only one dynamic name per
 * position. So the public URL is `/<locale>/blog/...` and it rewrites onto the
 * real route at `/blog/<locale>/...`, which collides with nothing. The visitor's
 * address bar keeps the locale prefix; the router sees a path it can resolve.
 *
 * Safe against shop handles by construction: `HANDLE_MIN` is 3, and every
 * locale code but `fil` is two characters, so 34 of them can never be a handle.
 * `fil` is in `RESERVED_HANDLES`.
 */

const CODES = LOCALES.map((l) => l.code);

/** `/fr/blog`, `/fr/blog/slug`, `/fr/blog/page/2` — and nothing else. */
const PREFIXED = new RegExp(`^/(${CODES.join("|")})/blog(/.*)?$`);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * A signed-in seller asking for the landing page wants their admin.
   *
   * This used to be a `redirect()` inside the page, and the page sits behind
   * `(marketing)/loading.tsx` — so Next streamed the shell first and answered
   * 200. The seller watched the splash, then the header and footer with an
   * empty page between them, and only then a client-side hop to /admin. Three
   * screens to get where they were already going.
   *
   * The cookie is the whole test here on purpose. Verifying the session means
   * a database round trip, which the proxy runs on every matched request and
   * which is exactly the work worth avoiding before a redirect. A cookie that
   * turns out to be stale costs one extra hop: /admin checks the real session
   * and sends them to /login, which is where they were going anyway.
   */
  if (pathname === "/" && getSessionCookie(request)) {
    const to = request.nextUrl.clone();
    to.pathname = "/admin";
    // Temporary: the same URL serves the marketing page to everyone else.
    return NextResponse.redirect(to, 307);
  }

  /*
   * `/blog` has no content of its own — it sends the reader to their language.
   *
   * Done here rather than in the page because the root layout reads cookies, so
   * by the time a Server Component could call `redirect()` the response has
   * begun streaming and the status is already 200. A crawler following a 200
   * would index `/blog` as a duplicate of `/en/blog`. The proxy runs before any
   * of that and can answer with a real 307.
   */
  if (pathname === "/blog") {
    const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = isLocale(cookie)
      ? cookie
      : (matchAcceptLanguage(request.headers.get("accept-language")) ?? DEFAULT_LOCALE);

    const to = request.nextUrl.clone();
    to.pathname = `/${locale}/blog`;
    // Temporary: which language a visitor gets depends on who is asking, so
    // this must never be cached as a permanent move.
    return NextResponse.redirect(to, 307);
  }

  const match = PREFIXED.exec(pathname);
  if (!match) return NextResponse.next();

  const [, locale, rest = ""] = match;

  const url = request.nextUrl.clone();
  url.pathname = `/blog/${locale}${rest}`;
  return NextResponse.rewrite(url);
}

/*
 * Only the locale-prefixed blog paths. Everything else — shops, admin, the
 * marketing pages — is untouched, so this cannot slow down or reroute a request
 * it is not responsible for.
 *
 * Written out rather than built from `LOCALES`: Next reads this field
 * statically at build time and refuses an expression. The `LOCALE_CODES` test
 * in `proxy.test.ts` fails if this list and `i18n/config` ever drift apart.
 *
 * `fil` leads the alternation so it is not shadowed by `fi`.
 */
export const config = {
  matcher: [
    // The landing page, so a signed-in seller is sent to their admin before
    // any of it is rendered.
    "/",
    "/blog",
    "/:locale(fil|ar|bg|bs|cs|da|de|el|en|es|fi|fr|hr|hu|id|it|ja|ko|mk|ms|nl|no|pl|pt|ro|ru|sl|sq|sr|sv|th|tr|uk|vi|zh)/blog",
    "/:locale(fil|ar|bg|bs|cs|da|de|el|en|es|fi|fr|hr|hu|id|it|ja|ko|mk|ms|nl|no|pl|pt|ro|ru|sl|sq|sr|sv|th|tr|uk|vi|zh)/blog/:path*",
  ],
};
