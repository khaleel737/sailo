"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/settings", label: "Shop details", exact: true },
  { href: "/admin/settings/billing", label: "Plan & billing" },
  { href: "/admin/settings/data", label: "Import & export" },
];

export function SettingsNav() {
  const pathname = usePathname();

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
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition",
              active
                ? "border-ink-900 text-ink-900"
                : "border-transparent text-ink-500 hover:text-ink-900",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
