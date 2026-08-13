import Link from "next/link";
import { Menu } from "lucide-react";
import { SailoLogo, SailoMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import type { Locale } from "@sailo/i18n/config";
import type { MarketingDictionary } from "@sailo/i18n/marketing";
import { Container, Cta } from "./kit";

/**
 * The marketing header. 64px, one line, five links.
 *
 * The small-screen menu is a `<details>` rather than a state hook: it is a
 * disclosure, the element already carries the keyboard behaviour and the
 * expanded/collapsed semantics, and it works before and without hydration. The
 * only client island up here is the language picker, which genuinely needs one.
 */
export function SiteNav({
  t,
  locale,
  languageLabel,
}: {
  t: MarketingDictionary;
  locale: Locale;
  /** From the storefront dictionary, which already owns the word. */
  languageLabel: string;
}) {
  /*
     Rooted at "/" rather than a bare "#section": these are in-page anchors on
     the landing page, but the same nav now renders on /blog, where "#pricing"
     would scroll to nothing. "/#pricing" navigates home and then scrolls.
  */
  const links = [
    { href: "/#compare", label: t.nav.how },
    { href: "/#demos", label: t.nav.demos },
    { href: "/#features", label: t.nav.features },
    // A real page now, not an anchor. Linking the page rather than "/#pricing"
    // is also what gives it internal links from every marketing page, which is
    // the cheapest ranking signal a new page can get.
    { href: "/pricing", label: t.nav.pricing },
    { href: "/#faq", label: t.nav.faq },
    // The only entry that leaves the page, so it goes last — everything
    // above it scrolls, and a route change in the middle of a scroll menu
    // reads as a mis-tap.
    { href: "/blog", label: t.nav.blog },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--mute-200)] bg-[var(--paper)]/85 backdrop-blur-xl">
      <Container className="flex h-16 items-center gap-4 lg:gap-8">
        {/* The mark is small; the tap target around it is not. */}
        <Link
          href="/"
          aria-label="Sailo"
          className="focus-line -mx-2 flex shrink-0 items-center px-2 py-3 text-[var(--ink)]"
        >
          {/* Below `sm` the wordmark costs ~56px the header does not have: the
              longest translated CTA plus a menu button already fills a 320px
              screen. The mark alone still identifies the page. */}
          <SailoMark className="size-6 sm:hidden" />
          <SailoLogo className="hidden h-[1.3rem] w-auto sm:block" />
        </Link>

        <nav aria-label={t.footer.product} className="hidden flex-1 lg:block">
          <ul className="flex items-center gap-7">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="focus-line draw-underline inline-flex items-center py-3 text-[0.875rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-3 lg:ms-0">
          <div className="hidden sm:block">
            <LanguageSwitcher
              current={locale}
              align="end"
              label={languageLabel}
              size="md"
            />
          </div>
          <Link
            href="/login"
            className="focus-line draw-underline hidden items-center px-1 py-3 text-[0.875rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)] sm:inline-flex"
          >
            {t.nav.signIn}
          </Link>
          <Cta href="/signup" size="sm">
            {t.nav.createShop}
          </Cta>

          <details className="group relative lg:hidden">
            <summary
              aria-label={t.nav.openMenu}
              className="focus-line flex size-10 cursor-pointer list-none items-center justify-center rounded-[var(--r-pill)] text-[var(--mute-600)] transition-colors hover:bg-[var(--mute-100)] [&::-webkit-details-marker]:hidden"
            >
              <Menu className="size-5" />
            </summary>
            <div className="absolute end-0 top-full mt-3 w-[min(15rem,calc(100vw-2.5rem))] rounded-[var(--r-card)] border border-[var(--mute-200)] bg-[var(--paper)] p-2 shadow-[0_24px_60px_-24px_rgb(11_11_12/0.3)]">
              <ul>
                {links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="focus-line flex min-h-11 items-center rounded-[14px] px-3 text-[0.875rem] text-[var(--mute-600)] transition-colors hover:bg-[var(--mute-100)] hover:text-[var(--ink)]"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
                <li className="mt-1 border-t border-[var(--mute-200)] pt-1 sm:hidden">
                  <Link
                    href="/login"
                    className="focus-line flex min-h-11 items-center rounded-[14px] px-3 text-[0.875rem] text-[var(--mute-600)] transition-colors hover:bg-[var(--mute-100)]"
                  >
                    {t.nav.signIn}
                  </Link>
                </li>
                {/* Below `sm` the header has no room for the picker, and the
                    footer is a long way down for someone who landed in the
                    wrong language. */}
                <li className="px-3 py-2 sm:hidden">
                  <LanguageSwitcher
                    current={locale}
                    align="start"
                    label={languageLabel}
                    size="md"
                  />
                </li>
              </ul>
            </div>
          </details>
        </div>
      </Container>
    </header>
  );
}
