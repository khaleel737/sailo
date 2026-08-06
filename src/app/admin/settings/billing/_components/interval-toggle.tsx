"use client";

import Link from "next/link";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { cn } from "@/lib/utils";

/**
 * Links rather than buttons — the interval is in the URL, so the choice
 * survives a refresh and can be shared. Styled to match `SegmentedControl`;
 * that component drives local state and can't carry an href.
 */
export function IntervalToggle({ interval }: { interval: "month" | "year" }) {
  const a = useAdminT();

  return (
    <div className="inline-flex rounded-xl border border-ink-200 bg-ink-50 p-1">
      {(["month", "year"] as const).map((value) => {
        const active = interval === value;
        return (
          <Link
            key={value}
            href={`/admin/settings/billing?interval=${value}`}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={cn(
              "focus-ring inline-flex items-center rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors duration-200",
              "pointer-coarse:min-h-11",
              active
                ? "bg-white text-ink-900 shadow-xs"
                : "text-ink-500 hover:text-ink-900",
            )}
          >
            {value === "month" ? a.billing.monthly : a.billing.yearly}
            {value === "year" ? (
              <span className="ms-1.5 text-xs font-semibold text-brand-600">
                −20%
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
