import { Suspense } from "react";
import { GoogleTag } from "@/lib/google-tag";
import { ConsentGate } from "@/components/shared/consent-gate";
import { SiteNav } from "@/components/marketing/site-nav";
import { getT, getLocale } from "@/i18n/server";
import { getMarketingDictionary } from "@sailo/i18n/marketing";
import { SiteFooter } from "./_components/site-footer";

/*
 * Not yet converted. The copy on these pages is chosen by a cookie, so the
 * response varies per visitor and cannot be prerendered until the locale
 * moves into the URL the way the blog's already has.
 */
/**
 * The chrome every public marketing page wears.
 *
 * This used to live inside the landing page, which was fine while the landing
 * page was the only thing in this group. Adding the blog exposed it: `/blog`
 * rendered with no header and no footer, which is not a page on a website so
 * much as a page next to one.
 *
 * The skip link lives here too, so keyboard users get the same first tab stop
 * on every page rather than only on the homepage.
 */
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="brand-surface flex min-h-screen flex-col">
      {/*
        Header and footer stream; the page between them does not wait.

        They read the visitor's locale, and this layout wraps every marketing
        route including 446 blog pages whose language is already in their URL.
        Awaiting here made all of them request-bound for the sake of a nav bar.
        As siblings of `{children}` rather than an `await` above it, the
        articles prerender and the chrome fills in around them.
      */}
      <Suspense fallback={<div className="h-16" />}>
        <MarketingChrome />
      </Suspense>

      <main id="main" className="flex-1">
        {children}
      </main>

      <Suspense fallback={null}>
        <MarketingFooter />
      </Suspense>
      {/* Both read the visitor's locale, so both stream rather than blocking
          the page they sit beside. */}
      <Suspense fallback={null}>
        <GoogleTag />
      </Suspense>
      <Suspense fallback={null}>
        <ConsentGate />
      </Suspense>
    </div>
  );
}

/** Skip link and nav, in the visitor's language. */
async function MarketingChrome() {
  const locale = await getLocale();
  const [{ t }, m] = await Promise.all([getT(), getMarketingDictionary(locale)]);

  return (
    <>
      <a
        href="#main"
        className="focus-line sr-only focus:not-sr-only focus:absolute focus:start-5 focus:top-5 focus:z-50 focus:rounded-[var(--r-pill)] focus:bg-[var(--ink)] focus:px-5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-[var(--paper)]"
      >
        {m.nav.skip}
      </a>
      <SiteNav t={m} locale={locale} languageLabel={t.common.language} />
    </>
  );
}

async function MarketingFooter() {
  const locale = await getLocale();
  const [{ t }, m] = await Promise.all([getT(), getMarketingDictionary(locale)]);
  return <SiteFooter locale={locale} t={t} m={m} />;
}
