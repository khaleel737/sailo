import Link from "next/link";
import { Sparkles } from "lucide-react";
import { planFor } from "@sailo/core/plans";
import { SailoMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { HelpLink } from "./help-link";
import { NotificationBell } from "./notification-bell";
import { UpgradeButton } from "./upgrade-modal";
import { CommandPalette, type PaletteEntry } from "./command-palette";
import { AccountMenu } from "./account-menu";
import { MobileMenu, type NavProps } from "./sidebar";
import type { Notification } from "@sailo/notifications/feed";
import type { Shop } from "@sailo/db/schema";
import type { Dictionary } from "@sailo/i18n";
import type { Locale } from "@sailo/i18n/config";

/**
 * The bar across the top — Shopify's frame, worn Sailo's way.
 *
 * One dark strip owns the three things that are true on every page: whose
 * shop this is (left), the way to anywhere (the search in the middle), and
 * the account — plan, language, help, what needs attention, sign out — on
 * the right. The rail below it can then be pure navigation, which is the
 * whole trick of this layout: chrome in one place, places in the other.
 */
export function Topbar({
  shop,
  notifications,
  locale,
  t,
  docsUrl,
  entries,
  nav,
}: {
  shop: Shop;
  notifications: Notification[];
  locale: Locale;
  t: Dictionary;
  docsUrl: string;
  entries: PaletteEntry[];
  /** Counts and dictionary for the phone sheet's copy of the rail. */
  nav: NavProps;
}) {
  const plan = planFor(shop);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 bg-ink-950 ps-3 pe-2 sm:gap-3 sm:px-4">
      <Link
        href="/admin"
        className="focus-ring flex min-w-0 shrink-0 items-center gap-2 rounded-lg px-1 py-1"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
          <SailoMark className="size-5" />
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-44 truncate text-[13px] font-semibold leading-tight text-white">
            {shop.name}
          </span>
          <span dir="ltr" className="block truncate text-start text-[11px] leading-tight text-white/40">
            /{shop.handle}
          </span>
        </span>
      </Link>

      <div className="flex min-w-0 flex-1 justify-center">
        <CommandPalette entries={entries} />
      </div>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        {plan.id === "free" ? (
          <UpgradeButton
            currentPlan={plan.id}
            t={t}
            className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white transition hover:bg-brand-500 pointer-coarse:h-10"
          >
            <Sparkles className="size-3.5" />
            {t.nav.upgrade}
          </UpgradeButton>
        ) : (
          <Link
            href="/admin/settings/billing"
            className="focus-ring hidden h-8 items-center rounded-lg bg-white/[0.08] px-3 text-xs font-medium text-white/80 ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.13] hover:text-white sm:inline-flex pointer-coarse:h-10"
          >
            {plan.name}
          </Link>
        )}

        <span className="hidden lg:contents">
          <LanguageSwitcher
            current={locale}
            align="end"
            label={t.common.language}
            variant="onDark"
          />
          <HelpLink variant="onDark" />
        </span>

        <NotificationBell items={notifications} locale={locale} t={t} variant="onDark" />

        <span className="hidden lg:block">
          <AccountMenu
            shopName={shop.name}
            handle={shop.handle}
            docsUrl={docsUrl}
            t={t}
          />
        </span>

        <MobileMenu
          shopName={shop.name}
          handle={shop.handle}
          docsUrl={docsUrl}
          locale={locale}
          {...nav}
        />
      </div>
    </header>
  );
}
