import Link from "next/link";
import { Menu } from "lucide-react";
import { SailoLogo } from "@/components/brand";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import type { Locale } from "@/i18n/config";
import type { MarketingDictionary } from "@/i18n/marketing";

/**
 * The marketing header.
 *
 * The small-screen menu is a `<details>` rather than a state hook: it is a
 * disclosure, the element already has the keyboard behaviour and the
 * expanded/collapsed semantics, and it works before — and without — hydration.
 * The only client island in the header is the language picker, which genuinely
 * needs one.
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
  const links = [
    { href: "#how", label: t.nav.how },
    { href: "#demos", label: t.nav.demos },
    { href: "#features", label: t.nav.features },
    { href: "#pricing", label: t.nav.pricing },
    { href: "#faq", label: t.nav.faq },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200/70 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="focus-ring shrink-0 rounded-lg text-brand-700">
          <SailoLogo className="h-6 w-auto" />
          <span className="sr-only">Sailo</span>
        </Link>

        <nav aria-label={t.nav.features} className="hidden flex-1 lg:block">
          <ul className="flex items-center justify-center gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="focus-ring rounded-lg px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-1.5 lg:ms-0">
          <div className="hidden sm:block">
            <LanguageSwitcher current={locale} align="end" label={t.nav.openMenu} />
          </div>
          <Link
            href="/login"
            className="focus-ring hidden rounded-xl px-3.5 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900 sm:inline-flex"
          >
            {t.nav.signIn}
          </Link>
          <Link
            href="/signup"
            className="focus-ring press rounded-xl bg-brand-700 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-brand-600"
          >
            {t.nav.createShop}
          </Link>

          <details className="group relative lg:hidden">
            <summary
              aria-label={t.nav.openMenu}
              className="focus-ring flex size-9 cursor-pointer list-none items-center justify-center rounded-xl text-ink-600 transition hover:bg-ink-100 [&::-webkit-details-marker]:hidden"
            >
              <Menu className="size-5" />
            </summary>
            <div className="absolute end-0 top-full mt-2 w-56 rounded-2xl border border-ink-200 bg-white p-1.5 shadow-xl">
              <ul>
                {links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="focus-ring block rounded-lg px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
                <li className="mt-1 border-t border-ink-200 pt-1 sm:hidden">
                  <Link
                    href="/login"
                    className="focus-ring block rounded-lg px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100"
                  >
                    {t.nav.signIn}
                  </Link>
                </li>
              </ul>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
