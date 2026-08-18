import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Dictionary } from "@sailo/i18n";
import type { MarketingDictionary } from "@sailo/i18n/marketing";
import { getBlogDictionary } from "@sailo/i18n/marketing/blog";
import type { Locale } from "@sailo/i18n/config";
import { DEMOS } from "@sailo/marketing/demos";
import { appOrigin } from "@sailo/core/origin";
import { SailoLogo } from "@/components/brand";
import { CookieSettingsButton } from "@/components/shared/cookie-settings-button";
import { measurementId } from "@/lib/google-tag";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { Container } from "@/components/marketing/kit";
import { NewsletterForm } from "@/components/marketing/newsletter-form";

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
    { href: "/anti-spam", label: m.footer.antiSpam },
  ];

  const b = getBlogDictionary(locale);

  return (
    <footer className="border-t border-[var(--mute-200)] py-16">
      <Container>
        {/*
          The list, on every marketing page rather than only on the blog.

          The blog is where most people meet the newsletter, but it is not the
          only page somebody reads and leaves: the pricing page, the docs and
          the landing page all end with a visitor who is interested and not yet
          ready, and until now the only thing any of them could do was close
          the tab. `source="footer"` keeps them distinguishable in the list from
          the readers an article won, because those two audiences behave
          differently and only the second one says anything about the writing.
        */}
        <section className="mb-14 border-b border-[var(--mute-200)] pb-14">
          <div className="grid gap-6 lg:grid-cols-[1fr_28rem] lg:items-center lg:gap-16">
            <div>
              <h2 className="display-sm text-[clamp(1.125rem,2.4vw,1.5rem)] leading-snug text-[var(--ink)]">
                {b.subscribeTitle}
              </h2>
              <p className="mt-2 max-w-md text-[0.875rem] leading-[1.7] text-[var(--mute-500)]">
                {b.subscribeBody}
              </p>
            </div>
            <NewsletterForm locale={locale} b={b} source="footer" />
          </div>
        </section>

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
                {/*
                  The developer documentation — the REST API, the webhooks and
                  the MCP server. It is public and unauthenticated on purpose
                  (see `docs/page.tsx`), and until now nothing on the marketing
                  site linked to it: somebody deciding whether Sailo fits their
                  stack had to already know the URL, and a crawler only ever
                  reached it through the sitemap. One footer link on every
                  marketing page fixes both.
                */}
                <li>
                  <Link
                    href="/docs"
                    className="focus-line inline-flex min-h-11 items-center text-[0.875rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
                  >
                    {m.footer.docs}
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
            <span dir="ltr">{new URL(appOrigin()).host}</span>
          </div>
        </div>
      </Container>
    </footer>
  );
}
