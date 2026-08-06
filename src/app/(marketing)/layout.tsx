import { GoogleTag } from "@/lib/google-tag";
import { SiteNav } from "@/components/marketing/site-nav";
import { getT, getLocale } from "@/i18n/server";
import { getMarketingDictionary } from "@/i18n/marketing";
import { SiteFooter } from "./_components/site-footer";

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
export default async function MarketingLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const [{ t }, m] = await Promise.all([getT(), getMarketingDictionary(locale)]);

  return (
    <div className="brand-surface flex min-h-screen flex-col">
      <a
        href="#main"
        className="focus-line sr-only focus:not-sr-only focus:absolute focus:start-5 focus:top-5 focus:z-50 focus:rounded-[var(--r-pill)] focus:bg-[var(--ink)] focus:px-5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-[var(--paper)]"
      >
        {m.nav.skip}
      </a>

      <SiteNav t={m} locale={locale} languageLabel={t.common.language} />

      <main id="main" className="flex-1">
        {children}
      </main>

      <SiteFooter locale={locale} t={t} m={m} />
      <GoogleTag />
    </div>
  );
}
