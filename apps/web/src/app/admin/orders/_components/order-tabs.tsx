"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@sailo/design-system/web/cn";
import { interpolate } from "@sailo/i18n";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * The status dimension, promoted from a dropdown to the shelf it always was.
 *
 * A seller works the orders list status by status — what's new, what's to
 * ship, what's done — and a `<select>` hides that rhythm behind a click and
 * shows no numbers. Tabs show the whole lifecycle at once with a count on
 * each, which is also triage: "New 3" is a to-do list before anything is
 * opened.
 *
 * Links, not buttons: the selected tab lives in the URL with the rest of the
 * filters, so "here are my unpaid bank transfers" stays a thing a seller can
 * send. Counts are computed under the other filters and ignore the selected
 * tab itself — see `getShopOrderStatusCounts`.
 */
export function OrderTabs({
  statuses,
  counts,
}: {
  statuses: { value: string; label: string }[];
  counts: Record<string, number>;
}) {
  const a = useAdminT();
  const pathname = usePathname();
  const params = useSearchParams();
  const reduced = useReducedMotion();
  const current = params.get("status") ?? "";

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  const hrefFor = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("status", value);
    else next.delete("status");
    return next.size ? `${pathname}?${next}` : pathname;
  };

  const tab = (value: string, label: string, count: number) => {
    const active = current === value;
    return (
      <Link
        key={value || "all"}
        href={hrefFor(value)}
        replace
        scroll={false}
        aria-current={active ? "page" : undefined}
        aria-label={interpolate(a.orderList.tabCount, {
          label,
          count: String(count),
        })}
        className={cn(
          "focus-ring press relative inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors duration-150 pointer-coarse:h-10",
          active ? "text-white" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900",
        )}
      >
        {active ? (
          /*
           * The pill is one element the whole row shares — `layoutId` makes
           * it glide from the old tab to the new one instead of blinking
           * across, which is what says "same shelf, different drawer".
           * A spring, because a tab change is user-initiated and brief.
           */
          <motion.span
            layoutId="orders-status-pill"
            aria-hidden
            transition={
              reduced
                ? { duration: 0 }
                : { type: "spring", duration: 0.35, bounce: 0.15 }
            }
            className="absolute inset-0 rounded-lg bg-ink-900 shadow-xs"
          />
        ) : null}
        <span className="relative">{label}</span>
        {count > 0 ? (
          <span
            className={cn(
              "tabular relative text-[11px]",
              active ? "text-white/60" : "text-ink-400",
            )}
          >
            {count.toLocaleString()}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1 rounded-xl border border-ink-200 bg-white p-1 shadow-xs">
      {tab("", a.orderList.all, total)}
      {statuses.map((s) => tab(s.value, s.label, counts[s.value] ?? 0))}
    </div>
  );
}
