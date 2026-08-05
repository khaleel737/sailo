import Link from "next/link";
import { Gift, Store } from "lucide-react";
import type { Shop } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { formatPercent } from "@/lib/pricing";
import { LanguageSwitcher } from "@/components/shared/language-switcher";

/** The referral invitation, the Sailo badge, and the language switcher. */
export function ShopFooter({
  shop,
  affiliatesLive,
  showBadge,
  locale,
  t,
}: {
  shop: Shop;
  affiliatesLive: boolean;
  showBadge: boolean;
  locale: Locale;
  t: Dictionary;
}) {
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

      {showBadge ? (
        <Link
          href="/"
          className="text-muted inline-flex items-center gap-1.5 text-xs transition hover:opacity-70"
        >
          <Store className="size-3.5" />
          {t.shop.poweredBy} <span className="font-semibold">Sailo</span>
        </Link>
      ) : null}

      <LanguageSwitcher current={locale} label={t.common.language} />
    </footer>
  );
}
