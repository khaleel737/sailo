import Link from "next/link";
import { ExternalLink, Sparkles } from "lucide-react";
import { planFor } from "@/lib/plans";
import { NotificationBell } from "./notification-bell";
import { UpgradeButton } from "./upgrade-modal";
import type { Notification } from "@/lib/notifications";
import type { Shop } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { LanguageSwitcher } from "@/components/shared/language-switcher";

/*
 * The header carries the four things that are true of every page rather than
 * of any one: which plan is paying for this, where the public shop is, what
 * language the admin is in, and what needs attention.
 */
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
    <header className="sticky top-0 z-30 hidden items-center justify-end gap-1.5 bg-ink-50/85 px-4 py-2.5 backdrop-blur-md sm:px-6 lg:flex lg:px-8">
      {plan.id === "free" ? (
        <UpgradeButton
          currentPlan={plan.id}
          t={t}
          className="focus-ring press inline-flex h-9 pointer-coarse:h-11 items-center gap-1.5 rounded-xl bg-brand-700 px-3.5 text-sm font-medium text-white shadow-xs transition hover:bg-brand-600"
        >
          <Sparkles className="size-3.5" />
          {t.nav.upgrade}
        </UpgradeButton>
      ) : (
        <Link
          href="/admin/settings/billing"
          className="focus-ring inline-flex h-9 pointer-coarse:h-11 items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3 text-sm font-medium text-brand-800 transition hover:bg-brand-100"
        >
          {plan.name}
        </Link>
      )}

      <a
        href={`/${shop.handle}`}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring hidden h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900 sm:inline-flex"
      >
        {t.nav.viewShop}
        <ExternalLink className="size-3.5" />
      </a>

      <LanguageSwitcher current={locale} align="end" label={t.common.language} />

      <NotificationBell items={notifications} locale={locale} t={t} />
    </header>
  );
}

/**
 * The same controls, folded into the mobile bar. The desktop header is hidden
 * below `lg` because the sidebar's own bar already occupies that row.
 */
export function AdminHeaderCompact({
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
    <div className="flex items-center gap-1 lg:hidden">
      {plan.id === "free" ? (
        <UpgradeButton
          currentPlan={plan.id}
          t={t}
          className="focus-ring press inline-flex h-9 pointer-coarse:h-11 items-center gap-1.5 rounded-xl bg-brand-700 px-3 text-xs font-medium text-white"
        >
          <Sparkles className="size-3.5" />
          {t.nav.upgrade}
        </UpgradeButton>
      ) : null}
      <NotificationBell items={notifications} locale={locale} t={t} />
    </div>
  );
}
