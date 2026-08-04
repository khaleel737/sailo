"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export function IntervalToggle({ interval }: { interval: "month" | "year" }) {
  return (
    <div className="inline-flex rounded-xl border border-ink-200 bg-white p-1">
      {(["month", "year"] as const).map((value) => (
        <Link
          key={value}
          href={`/admin/settings/billing?interval=${value}`}
          scroll={false}
          className={cn(
            "rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
            interval === value
              ? "bg-ink-900 text-white"
              : "text-ink-600 hover:text-ink-900",
          )}
        >
          {value === "month" ? "Monthly" : "Yearly"}
          {value === "year" ? (
            <span
              className={cn(
                "ml-1.5 text-xs",
                interval === value ? "text-white/70" : "text-emerald-600",
              )}
            >
              −20%
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
