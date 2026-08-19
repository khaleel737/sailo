import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Dictionary } from "@sailo/i18n";
import type { MarketingDictionary } from "@sailo/i18n/marketing";
import { getBlogDictionary } from "@sailo/i18n/marketing/blog";
import type { Locale } from "@sailo/i18n/config";
import { DEMOS } from "@sailo/marketing/demos";
import { SOCIALS, type SocialAccount } from "@sailo/marketing/socials";
import { Facebook, Instagram, LinkedIn, XMark } from "@sailo/design-system/web";
import { appOrigin, docsUrl } from "@sailo/core/origin";
import { SailoLogo } from "@/components/brand";
import { CookieSettingsButton } from "@/components/shared/cookie-settings-button";
import { measurementId } from "@/lib/google-tag";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { Container } from "@/components/marketing/kit";
import { NewsletterForm } from "@/components/marketing/newsletter-form";

/**
 * The mark for each account, kept beside the list rather than in it.
 *
 * `@sailo/marketing` is imported by the mailers and the cron jobs, and an icon
 * table there would put JSX — and with it React — into the dependency graph of
 * things that render no UI at all.
 */
const SOCIAL_ICONS: Record<
  SocialAccount["id"],
  (props: { className?: string }) => React.ReactElement
> = {
  instagram: Instagram,
  facebook: Facebook,
  linkedin: LinkedIn,
  x: XMark,
};

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

            {/*
              Where to find Sailo, in the identity block rather than the link
              columns. Those three columns are places on this site; these are
              four addresses somewhere else, and filing them under "Product"
              would send a reader looking for pricing to Instagram.

              No heading above them. One would need a dictionary key in 22
              languages to say what four recognisable marks already say, and a
              footer earns its quiet by not labelling the obvious.

              Marks only, no wordmarks: at 18px the stroke weight matches the
              14px link text beside it, so the row reads as one more line of
              the column instead of a toolbar bolted underneath it.
            */}
            <ul className="-ms-2.5 mt-3 flex items-center gap-1">
              {SOCIALS.map((account) => {
                const Icon = SOCIAL_ICONS[account.id];

                return (
                  <li key={account.id}>
                    <a
                      href={account.url}
                      target="_blank"
                      /*
                       * `me`, and pointedly not the `nofollow` the blog's
                       * share row carries. That row points at intent URLs on
                       * somebody else's domain; these are our own profiles,
                       * and the claim "this account and this site are the
                       * same brand" is the entire reason they are here.
                       */
                      rel="me noopener noreferrer"
                      aria-label={account.label}
                      title={account.label}
                      /*
                       * A 44px target around an 18px mark, matching the
                       * `min-h-11` every other link in this footer commits to
                       * — and `-ms-2.5` on the row pulls the first mark's
                       * edge back under the logo, because the padding that
                       * makes the target tappable would otherwise indent the
                       * row and break the column's left edge.
                       */
                      className="focus-line flex size-11 items-center justify-center rounded-full text-[var(--mute-400)] transition-colors hover:text-[var(--ink)]"
                    >
                      <Icon className="size-[1.125rem]" />
                    </a>
                  </li>
                );
              })}
            </ul>

            <div className="mt-3">
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
                  the MCP server. Public and unauthenticated on purpose:
                  somebody deciding whether Sailo fits their stack reads it
                  before they have an account, and one footer link on every
                  marketing page is how they and a crawler find it.

                  An `<a>` rather than a `Link`, and an absolute URL rather than
                  `/docs`. It is a different deployment on a different host now
                  — apps/docs, at docs.sailo.store — so there is no route here
                  to prefetch and `next/link` would be claiming otherwise.
                */}
                <li>
                  <a
                    href={docsUrl()}
                    className="focus-line inline-flex min-h-11 items-center text-[0.875rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
                  >
                    {m.footer.docs}
                  </a>
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
