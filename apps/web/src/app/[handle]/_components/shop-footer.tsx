import Link from "next/link";
import { Gift } from "lucide-react";
import type { Shop } from "@sailo/db/schema";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { formatPercent } from "@/lib/pricing";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { PoweredBy } from "@/components/shared/powered-by";
import { getMarketingDictionary } from "@/i18n/marketing";
import { hasPixels } from "@/lib/shop-pixels";
import { ShopCookieSettings } from "./shop-cookie-settings";

/**
 * The referral invitation, the Sailo badge, the platform's legal pages, and the
 * language switcher.
 *
 * The legal links sit here rather than only on the marketing site because this
 * is the page a buyer is actually on when they decide whether to hand over a
 * name and an address. Making them find the homepage first to learn how their
 * data is handled would be the wrong way round.
 *
 * They stay in the muted footer type, and they never compete with the seller's
 * own branding: this is our small print on their page.
 */
export function ShopFooter({
  shop,
  affiliatesLive,
  locale,
  t,
}: {
  shop: Shop;
  affiliatesLive: boolean;
  locale: Locale;
  t: Dictionary;
}) {
  const m = getMarketingDictionary(locale);

  return (
    <footer className="mt-14 flex flex-col items-center gap-3 text-center">
      {affiliatesLive ? (
        <Link
          href={`/${shop.handle}/affiliate`}
          className="surface-card inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition hover:opacity-70"
        >
          <Gift className="size-3.5" />
          {interpolate(t.shop.earnBySharing, {
            percent: formatPercent(shop.affiliateDefaultBp),
          })}
        </Link>
      ) : null}

      <PoweredBy shop={shop} t={t} />

      <nav aria-label={m.footer.legal}>
        <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
          {[
            { href: "/privacy", label: m.footer.privacy },
            { href: "/terms", label: m.footer.terms },
            { href: "/refunds", label: m.footer.refunds },
            { href: "/gdpr", label: m.footer.gdpr },
          ].map((doc) => (
            <li key={doc.href}>
              <Link
                href={doc.href}
                className="text-muted focus-ring-accent inline-flex min-h-11 items-center rounded text-xs transition hover:opacity-70"
              >
                {doc.label}
              </Link>
            </li>
          ))}
          {/*
            Only when this shop actually asks the question. Withdrawing has to
            be as easy as giving, so the same page that ran the tags carries
            the way to take the answer back — and a shop with no tags gets no
            button, because there would be nothing behind it.
          */}
          {hasPixels(shop) ? (
            <li>
              <ShopCookieSettings shopId={shop.id} label={t.consent.manage} />
            </li>
          ) : null}
        </ul>
      </nav>

      <LanguageSwitcher current={locale} label={t.common.language} />
    </footer>
  );
}
