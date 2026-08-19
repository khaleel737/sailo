"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@sailo/design-system/web/cn";

/**
 * The five tabs an account is read through.
 *
 * ─── WHY THESE ARE ROUTES AND NOT STATE ──────────────────────────────────────
 * A `useState` tab strip would have been fewer files and it would have loaded
 * every tab's data on every visit, which is the thing this split exists to
 * stop. As routes, each tab is its own server component with its own reads:
 * opening an account to check a plan costs the overview's four queries and
 * nothing else, and the tab that lists every buyer this shop has ever had is
 * paid for by the person who asked for it.
 *
 * It also makes each tab linkable, which matters more here than it sounds. The
 * risk desk links straight to `/accounts/<id>/risk`, and a support reply can
 * name the exact screen somebody needs rather than "the account page, scroll
 * down".
 *
 * A client component only for `usePathname` — the links are plain `<Link>`s and
 * nothing here holds state.
 */

const TABS = [
  { href: "", label: "Overview" },
  { href: "/commerce", label: "Commerce" },
  { href: "/money", label: "Money" },
  { href: "/risk", label: "Risk" },
  { href: "/security", label: "Security" },
] as const;

export function AccountTabs({
  userId,
  /** Rendered beside the label, for the tabs that have something to report. */
  badges = {},
}: {
  userId: string;
  badges?: Partial<Record<string, { count: number; tone: "red" | "amber" }>>;
}) {
  const pathname = usePathname();
  const base = `/accounts/${userId}`;

  return (
    <div className="mb-6 -mx-1 overflow-x-auto">
      <nav
        aria-label="Account sections"
        className="flex min-w-max gap-1 border-b border-ink-200 px-1"
      >
        {TABS.map((tab) => {
          const href = `${base}${tab.href}`;
          /*
           * Exact for the overview, prefix for the rest. Without the exact
           * test, `/accounts/x` is a prefix of every other tab's path and the
           * overview would render as active on all five.
           */
          const active = tab.href === "" ? pathname === href : pathname.startsWith(href);
          const badge = badges[tab.label];

          return (
            <Link
              key={tab.label}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-ring relative -mb-px flex items-center gap-1.5 rounded-t-lg px-3 py-2.5 text-sm font-medium transition-colors pointer-coarse:min-h-11",
                active
                  ? "border-b-2 border-ink-900 text-ink-900"
                  : "border-b-2 border-transparent text-ink-500 hover:text-ink-900",
              )}
            >
              {tab.label}
              {badge && badge.count > 0 ? (
                <span
                  className={cn(
                    "tabular rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                    badge.tone === "red"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-800",
                  )}
                >
                  {badge.count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
