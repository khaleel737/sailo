"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@sailo/design-system/web/cn";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/*
 * The tab list is built inside the component rather than at module scope,
 * because the labels are only known once the dictionary is. A module-level
 * constant is how these three came to be the last English words on an
 * otherwise translated settings page.
 */
export function SettingsNav() {
  const pathname = usePathname();
  const a = useAdminT();

  const TABS = [
    { href: "/admin/settings", label: a.settings.tabDetails, exact: true },
    { href: "/admin/settings/billing", label: a.settings.tabBilling },
    { href: "/admin/settings/tax", label: a.tax.title },
    { href: "/admin/settings/team", label: a.settings.tabTeam },
    { href: "/admin/settings/integrations", label: a.integrations.title },
    { href: "/admin/settings/fields", label: a.broadcasts.fieldsTitle },
    { href: "/admin/settings/security", label: a.settings.tabSecurity },
    { href: "/admin/settings/data", label: a.settings.tabData },
  ];

  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-ink-200">
      {TABS.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-ring -mb-px inline-flex shrink-0 items-center rounded-t-lg border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium",
              "pointer-coarse:min-h-11 pointer-coarse:pt-2.5",
              "transition-colors duration-150",
              active
                ? "border-brand-600 text-ink-900"
                : "border-transparent text-ink-500 hover:border-ink-200 hover:text-ink-900",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
