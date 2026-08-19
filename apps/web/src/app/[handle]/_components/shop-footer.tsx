import Link from "next/link";
import { Gift } from "lucide-react";
import type { Shop, ShopPage } from "@sailo/db/schema";
import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";
import type { Locale } from "@sailo/i18n/config";
import { formatPercent } from "@sailo/core/pricing";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { PoweredBy } from "@/components/shared/powered-by";
import { getMarketingDictionary } from "@sailo/i18n/marketing";
import { hasPixels } from "@sailo/customers/pixels";
import { ShopCookieSettings } from "./shop-cookie-settings";
import { CurrencySwitcher } from "./currency-switcher";

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
  shopPages,
  currency,
  currencyOptions,
  locale,
  t,
}: {
  shop: Shop;
  affiliatesLive: boolean;
  /**
   * The seller's *own* published documents — spec 41.
   *
   * Rendered above Sailo's, and in their own row, because they are not the same
   * kind of thing: these are the terms of the contract the buyer is about to
   * enter, and the ones below are the platform's small print. Mixing the two
   * lists would put "Sailo's refund policy" next to "this shop's refund policy"
   * with nothing to tell a buyer which one governs their order.
   *
   * Empty for every shop that has published nothing, which renders nothing.
   */
  shopPages: ShopPage[];
  /** What this visit is quoted in, and what may be switched to — spec 53. */
  currency: string;
  currencyOptions: string[];
  locale: Locale;
  t: Dictionary;
}) {
  const m = getMarketingDictionary(locale);

  return (
    <footer className="mt-14 flex flex-col items-center gap-3 text-center">
      {affiliatesLive ? (
        <Link
          href={`/${shop.handle}/affiliate`}
          className="surface-card inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium pointer-coarse:min-h-11 transition hover:opacity-70"
        >
          <Gift className="size-3.5" />
          {interpolate(t.shop.earnBySharing, {
            percent: formatPercent(shop.affiliateDefaultBp),
          })}
        </Link>
      ) : null}

      <PoweredBy shop={shop} t={t} />

      {shopPages.length > 0 ? (
        <nav aria-label={t.pages.shopPolicies}>
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
            {shopPages.map((page) => (
              <li key={page.id}>
                <Link
                  href={`/${shop.handle}/legal/${page.slug}`}
                  /*
                   * The seller's own title, in the language they wrote it. The
                   * document is English-only by design (§ "35 locales is the
                   * interesting problem here") and a translated label over an
                   * English page would promise a translation that is not there.
                   */
                  lang="en"
                  className="focus-ring-accent inline-flex min-h-11 items-center rounded text-xs font-medium transition hover:opacity-70"
                >
                  {page.title ?? page.slug}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <nav aria-label={m.footer.legal}>
        <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
          {[
            { href: "/privacy", label: m.footer.privacy },
            { href: "/terms", label: m.footer.terms },
            { href: "/refunds", label: m.footer.refunds },
            { href: "/gdpr", label: m.footer.gdpr },
            /*
             * Here as well as on the marketing footer, because this is the
             * side of the product that asks for an email address. A buyer
             * handing one to the subscribe card is exactly the reader the
             * policy is written for.
             */
            { href: "/anti-spam", label: m.footer.antiSpam },
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

      <div className="flex flex-wrap items-center justify-center gap-2">
        <LanguageSwitcher current={locale} label={t.common.language} />
        {/*
          Beside the language, and for the same reason it is there: both are
          "how this page is presented to me", both are read rarely and by the
          minority who need them, and neither belongs above the seller's own
          products. Renders nothing at all for a shop quoting one currency.
        */}
        <CurrencySwitcher
          current={currency}
          options={currencyOptions}
          locale={locale}
          t={t}
        />
      </div>
    </footer>
  );
}
