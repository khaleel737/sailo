import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Dictionary } from "@/i18n";
import type { MarketingDictionary } from "@/i18n/marketing";
import type { Locale } from "@/i18n/config";
import { DEMOS } from "@/lib/demos";
import { APP_URL } from "@/lib/seo";
import { SailoLogo } from "@/components/brand";
import { CookieSettingsButton } from "@/components/shared/cookie-settings-button";
import { measurementId } from "@/lib/google-tag";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { Container } from "@/components/marketing/kit";

/** The marketing footer. */

export function SiteFooter({
  locale,
  t,
  m,
}: {
  locale: Locale;
  t: Dictionary;
  m: MarketingDictionary;
}) {
  const legal = [
    { href: "/privacy", label: m.footer.privacy },
    { href: "/terms", label: m.footer.terms },
    { href: "/refunds", label: m.footer.refunds },
    { href: "/gdpr", label: m.footer.gdpr },
  ];

  return (
    <footer className="border-t border-[var(--mute-200)] py-16">
      <Container>
        <div className="grid gap-12 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <SailoLogo className="h-5 w-auto text-[var(--mute-400)]" />
            <p className="mt-5 max-w-xs text-[0.875rem] leading-relaxed text-[var(--mute-500)]">
              {m.footer.tagline}
            </p>
            <div className="mt-6">
              <LanguageSwitcher
                current={locale}
                align="start"
                label={t.common.language}
                size="md"
              />
            </div>
          </div>

          <div className="grid gap-10 sm:grid-cols-3 sm:gap-14">
            <nav aria-label={m.footer.liveShops}>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-[var(--mute-400)]">
                {m.footer.liveShops}
              </p>
              <ul className="mt-5 grid gap-3">
                {DEMOS.map((demo) => (
                  <li key={demo.handle}>
                    <Link
                      href={`/${demo.handle}`}
                      className="focus-line group inline-flex min-h-11 items-center gap-1.5 text-[0.875rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
                    >
                      {demo.name}
                      <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
                {/*
                  Shown only where the banner can appear. With no measurement
                  id there is no tag to consent to and nothing to withdraw, so
                  the button would clear an answer nobody was asked for.
                */}
                {measurementId() ? (
                  <li>
                    <CookieSettingsButton label={t.consent.manage} />
                  </li>
                ) : null}
              </ul>
            </nav>

            <nav aria-label={m.footer.product}>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-[var(--mute-400)]">
                {m.footer.product}
              </p>
              <ul className="mt-5 grid gap-3">
                <li>
                  <Link
                    href="/blog"
                    className="focus-line inline-flex min-h-11 items-center text-[0.875rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
                  >
                    {m.nav.blog}
                  </Link>
                </li>
              </ul>
            </nav>

            {/* Its own column, not a line of small print at the very bottom.
                A buyer deciding whether to trust a shop, and a payment
                provider reviewing the platform, both look for these first. */}
            <nav aria-label={m.footer.legal}>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-[var(--mute-400)]">
                {m.footer.legal}
              </p>
              <ul className="mt-5 grid gap-3">
                {legal.map((doc) => (
                  <li key={doc.href}>
                    <Link
                      href={doc.href}
                      className="focus-line inline-flex min-h-11 items-center text-[0.875rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
                    >
                      {doc.label}
                    </Link>
                  </li>
                ))}
                {/*
                  Shown only where the banner can appear. With no measurement
                  id there is no tag to consent to and nothing to withdraw, so
                  the button would clear an answer nobody was asked for.
                */}
                {measurementId() ? (
                  <li>
                    <CookieSettingsButton label={t.consent.manage} />
                  </li>
                ) : null}
              </ul>
            </nav>
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-5 border-t border-[var(--mute-200)] pt-8 text-[0.8125rem] text-[var(--mute-400)]">
          <span className="tabular">
            © {new Date().getFullYear()} Sailo. {m.footer.rights}
          </span>
          <div className="flex items-center gap-7">
            <Link
              href="/login"
              className="focus-line inline-flex min-h-11 items-center transition-colors hover:text-[var(--ink)]"
            >
              {m.nav.signIn}
            </Link>
            <Link
              href="/signup"
              className="focus-line inline-flex min-h-11 items-center transition-colors hover:text-[var(--ink)]"
            >
              {m.nav.createShop}
            </Link>
            {/* The domain reads left-to-right even when the page doesn't. */}
            <span dir="ltr">{new URL(APP_URL).host}</span>
          </div>
        </div>
      </Container>
    </footer>
  );
}
