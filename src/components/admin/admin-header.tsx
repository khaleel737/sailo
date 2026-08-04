import Link from "next/link";
import { ExternalLink, Sparkles } from "lucide-react";
import { planFor } from "@/lib/plans";
import { NotificationBell } from "./notification-bell";
import { UpgradeButton } from "./upgrade-modal";
import type { Notification } from "@/lib/notifications";
import type { Shop } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { LanguageSwitcher } from "@/components/shop/language-switcher";

export function AdminHeader({
  shop,
  notifications,
  locale,
  t,
}: {
  shop: Shop;
  notifications: Notification[];
  locale: Locale;
  t: Dictionary;
}) {
  const plan = planFor(shop);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-end gap-2 border-b border-ink-200 bg-white/90 px-4 py-2.5 backdrop-blur sm:px-6 lg:px-8">
      {plan.id === "free" ? (
        <UpgradeButton
          currentPlan={plan.id}
          t={t}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink-900 px-3 text-sm font-medium text-white transition hover:bg-ink-800"
        >
          <Sparkles className="size-3.5" />
          {t.nav.upgrade}
        </UpgradeButton>
      ) : (
        <Link
          href="/admin/settings/billing"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink-100 px-3 text-sm font-medium text-ink-700 transition hover:bg-ink-200"
        >
          {plan.name}
        </Link>
      )}

      <a
        href={`/${shop.handle}`}
        target="_blank"
        rel="noopener noreferrer"
        className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900 sm:inline-flex"
      >
        {t.nav.viewShop}
        <ExternalLink className="size-3.5" />
      </a>

      <LanguageSwitcher
        current={locale}
        align="end"
        label={t.common.language}
      />

      <NotificationBell items={notifications} locale={locale} t={t} />
    </header>
  );
}
