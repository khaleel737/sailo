"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import type { Dictionary } from "@/i18n";
import { ANALYTICS_RANGES, cheapestPlanWith, PLANS, PLAN_IDS } from "@/lib/plans";
import { UpgradeModal } from "./upgrade-modal";
import { cn } from "@/lib/utils";
import type { PlanId } from "@/lib/plans";

const LABELS: Record<number, string> = {
  7: "7 days",
  30: "30 days",
  90: "90 days",
  365: "1 year",
  1095: "3 years",
};

/** Cheapest plan whose analytics window covers this range. */
function planForRange(days: number): PlanId | null {
  return PLAN_IDS.find((id) => PLANS[id].limits.analyticsDays >= days) ?? null;
}

export function RangePicker({
  current,
  limit,
  currentPlan,
  t,
}: {
  current: number;
  /** The plan's maximum window in days. */
  limit: number;
  currentPlan: PlanId;
  t: Dictionary;
}) {
  const [upsell, setUpsell] = useState<number | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {ANALYTICS_RANGES.map((days) => {
          const locked = days > limit;
          const active = days === current;
          const needed = locked ? planForRange(days) : null;

          if (locked) {
            return (
              <button
                key={days}
                dir="auto"
                type="button"
                onClick={() => setUpsell(days)}
                title={`${LABELS[days]} is available on ${needed ? PLANS[needed].name : "a paid plan"}`}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-300 transition hover:text-ink-600 pointer-coarse:min-h-11"
              >
                <Lock className="size-3" />
                {LABELS[days]}
              </button>
            );
          }

          return (
            <Link
              key={days}
              dir="auto"
              href={`/admin?range=${days}`}
              scroll={false}
              className={cn(
                "inline-flex items-center rounded-lg px-2.5 py-1.5 text-sm font-medium transition",
                "pointer-coarse:min-h-11",
                active
                  ? "bg-brand-700 text-white shadow-xs"
                  : "text-ink-500 hover:text-ink-900",
              )}
            >
              {LABELS[days]}
            </Link>
          );
        })}
      </div>

      <UpgradeModal
        open={upsell !== null}
        onClose={() => setUpsell(null)}
        currentPlan={currentPlan}
        t={t}
        title={`See ${upsell ? LABELS[upsell] : ""} of history`}
        body={
          cheapestPlanWith("csvExport")
            ? "Longer analytics history comes with a paid plan, along with more products and your own branding."
            : undefined
        }
      />
    </>
  );
}
