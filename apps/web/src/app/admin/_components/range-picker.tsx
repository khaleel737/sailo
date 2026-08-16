"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarRange, Lock } from "lucide-react";
import type { Dictionary } from "@sailo/i18n";
import { ANALYTICS_RANGES, cheapestPlanWith, PLANS, PLAN_IDS } from "@sailo/core/plans";
import { UpgradeModal } from "./upgrade-modal";
import { cn } from "@/lib/utils";
import type { PlanId } from "@sailo/core/plans";

const LABELS: Record<number, string> = {
  7: "7 days",
  30: "30 days",
  90: "90 days",
  365: "1 year",
  1095: "3 years",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cheapest plan whose analytics window covers this range. */
function planForRange(days: number): PlanId | null {
  return PLAN_IDS.find((id) => PLANS[id].limits.analyticsDays >= days) ?? null;
}

export function RangePicker({
  current,
  limit,
  currentPlan,
  t,
  labels,
  custom,
  customFrom,
  customTo,
  clamped = false,
}: {
  current: number;
  /** The plan's maximum window in days. */
  limit: number;
  currentPlan: PlanId;
  t: Dictionary;
  /** Pre-resolved admin strings — this is a client component with no dictionary. */
  labels: { custom: string; from: string; to: string; apply: string };
  /** Whether the page is currently on a custom range. */
  custom?: boolean;
  /** The resolved custom bounds, as YYYY-MM-DD, for the inputs' initial state. */
  customFrom?: string;
  customTo?: string;
  /** The URL asked past the plan and was clamped — open the upgrade nudge. */
  clamped?: boolean;
}) {
  const router = useRouter();
  const [upsell, setUpsell] = useState<number | null>(null);
  const [showCustom, setShowCustom] = useState(Boolean(custom));
  const [from, setFrom] = useState(customFrom ?? "");
  const [to, setTo] = useState(customTo ?? "");

  /*
   * A hand-typed URL that reached past the plan was clamped server-side; the
   * modal names the fix rather than letting the shorter answer pass as the
   * one that was asked for. Once, on arrival — dismissing it keeps the
   * clamped window on screen.
   */
  useEffect(() => {
    if (clamped) setUpsell(limit + 1);
  }, [clamped, limit]);

  // The earliest day the plan can read, mirrored onto the input so the picker
  // can't offer what the server would refuse. The server clamps regardless.
  const minDay = new Date(Date.now() - (limit - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const apply = () => {
    if (!from || !to || from > to) return;
    if (from < minDay) {
      setUpsell(limit + 1);
      return;
    }
    router.push(`/admin?from=${from}&to=${to}`, { scroll: false });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {ANALYTICS_RANGES.map((days) => {
          const locked = days > limit;
          const active = !custom && days === current;
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

        <button
          type="button"
          dir="auto"
          onClick={() => setShowCustom((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition",
            "pointer-coarse:min-h-11",
            custom
              ? "bg-brand-700 text-white shadow-xs"
              : "text-ink-500 hover:text-ink-900",
          )}
        >
          <CalendarRange className="size-3.5" />
          {labels.custom}
        </button>
      </div>

      {showCustom ? (
        <div className="mt-2 flex w-full flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
            {labels.from}
            <input
              type="date"
              value={from}
              min={minDay}
              max={today}
              onChange={(e) => setFrom(e.target.value)}
              className="focus-ring h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-sm text-ink-900 pointer-coarse:h-11"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
            {labels.to}
            <input
              type="date"
              value={to}
              min={from || minDay}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              className="focus-ring h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-sm text-ink-900 pointer-coarse:h-11"
            />
          </label>
          <button
            type="button"
            onClick={apply}
            disabled={!from || !to || from > to}
            className="focus-ring press inline-flex h-9 items-center rounded-lg bg-brand-700 px-3.5 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-40 pointer-coarse:h-11"
          >
            {labels.apply}
          </button>
        </div>
      ) : null}

      <UpgradeModal
        open={upsell !== null}
        onClose={() => setUpsell(null)}
        currentPlan={currentPlan}
        t={t}
        title={
          upsell !== null && LABELS[upsell]
            ? `See ${LABELS[upsell]} of history`
            : "See more history"
        }
        body={
          cheapestPlanWith("csvExport")
            ? "Longer analytics history comes with a paid plan, along with more products and your own branding."
            : undefined
        }
      />
    </>
  );
}
