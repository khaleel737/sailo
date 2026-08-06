import { GoogleTag } from "@/lib/google-tag";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { SailoLogo } from "@/components/brand";
import { PhoneFrame } from "@/components/marketing/frames";
import { HERO_DEMO, phoneShotUrl } from "@/lib/demos";
import { getT } from "@/i18n/server";
import { getMarketingDictionary } from "@/i18n/marketing";

/*
 * Sign in, sign up, and the two password screens.
 *
 * Two panes on a laptop: the form on one side, the reason to fill it in on the
 * other. Below `lg` the second pane is dropped rather than stacked, because
 * nobody scrolls past a sales pitch to reach a password field.
 *
 * The right pane carries a real screenshot of a real shop, not an illustration.
 * Same argument the landing page makes and the same asset, so someone arriving
 * from the hero recognises where they have landed.
 *
 * Its copy comes from the marketing dictionary, which is already translated
 * into every locale Sailo ships. The previous version had four English
 * sentences hard-coded in this file that every non-English visitor read in
 * English.
 */
export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const { locale, t, dir } = await getT();
  const m = getMarketingDictionary(locale);

  const reasons = [m.compare.shop1, m.compare.shop2, m.compare.shop3, m.compare.shop4];

  return (
    <div
      dir={dir}
      lang={locale}
      className="brand-surface flex min-h-[100dvh] flex-col lg:flex-row"
    >
      {/* --- Form side ----------------------------------------------------- */}
      <div className="flex w-full flex-1 flex-col px-5 pb-10 pt-6 sm:px-8 lg:w-[54%] lg:flex-none lg:px-14 lg:pb-12 lg:pt-8">
        <header className="flex items-center justify-between gap-4">
          <Link
            href="/"
            aria-label="Sailo"
            className="focus-line -mx-2 flex items-center px-2 py-3 text-[var(--ink)]"
          >
            <SailoLogo className="h-[1.3rem] w-auto" />
          </Link>
          <LanguageSwitcher
            current={locale}
            align="end"
            label={t.common.language}
            size="md"
          />
        </header>

        <main className="flex flex-1 items-center justify-center py-12 lg:py-16">
          <div className="w-full max-w-[25rem]">{children}</div>
        </main>

        {/* A way back out. Someone who clicked "Sign in" by mistake should not
            have to reach for the browser's back button. */}
        <Link
          href="/"
          className="focus-line mx-auto inline-flex min-h-11 items-center gap-2 text-[0.8125rem] text-[var(--mute-400)] transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" />
          {m.footer.tagline}
        </Link>
      </div>

      {/* --- Proof side ---------------------------------------------------- */}
      <aside className="relative hidden overflow-hidden bg-[var(--ink)] lg:flex lg:w-[46%] lg:flex-col lg:justify-center lg:px-14 xl:px-20">
        <div className="relative flex items-center gap-12">
          <div className="min-w-0 flex-1">
            <p className="display-sm text-[clamp(1.5rem,2.2vw,1.875rem)] text-[var(--paper)]">
              {m.cta.title}
            </p>

            <ul className="mt-9 space-y-4">
              {reasons.map((reason) => (
                <li
                  key={reason}
                  className="flex items-start gap-3.5 text-[0.9375rem] leading-snug text-[var(--on-ink-soft)]"
                >
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-[var(--on-ink-mute)]"
                    strokeWidth={2.5}
                  />
                  {reason}
                </li>
              ))}
            </ul>

            <p
              dir="ltr"
              className="mt-10 inline-flex items-center gap-2.5 rounded-[var(--r-pill)] border border-white/15 px-4 py-2 text-[0.8125rem] text-[var(--on-ink-mute)]"
            >
              <span
                aria-hidden
                style={{ backgroundColor: HERO_DEMO.accent }}
                className="size-2 rounded-full"
              />
              sailo.store/{HERO_DEMO.handle}
            </p>
          </div>

          {/* Cropped by the pane on purpose: the phone reads as a device sitting
              just off-screen rather than as a floating illustration. */}
          <PhoneFrame
            src={phoneShotUrl(HERO_DEMO.handle)}
            alt={HERO_DEMO.name}
            className="-me-14 hidden w-[14rem] shrink-0 xl:block"
            sizes="240px"
          />
        </div>
      </aside>
      <GoogleTag />
    </div>
  );
}
