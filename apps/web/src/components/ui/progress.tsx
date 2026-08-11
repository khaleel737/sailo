import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Progress and stepper. */

export function Progress({
  value,
  tone = "brand",
  className,
  label,
}: {
  /** 0–1. */
  value: number;
  tone?: "brand" | "ink" | "amber" | "red";
  className?: string;
  label?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-ink-100", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out-expo)]",
          {
            brand: "bg-brand-600",
            ink: "bg-ink-900",
            amber: "bg-amber-500",
            red: "bg-red-500",
          }[tone],
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Numbered progress for a multi-step flow. Steps behind you are ticked. */
export function Stepper({
  steps,
  current,
  className,
}: {
  steps: readonly string[];
  /** Zero-based index of the step being shown. */
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-center gap-2", className)}>
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-300",
                done
                  ? "bg-brand-700 text-white"
                  : active
                    ? "bg-brand-100 text-brand-900 ring-2 ring-brand-600"
                    : "bg-ink-100 text-ink-400",
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={cn(
                "hidden truncate text-xs font-medium transition-colors sm:block",
                active ? "text-ink-900" : done ? "text-ink-600" : "text-ink-400",
              )}
            >
              {step}
            </span>
            {i < steps.length - 1 ? (
              <span
                className={cn(
                  "h-px min-w-2 flex-1 transition-colors duration-300",
                  done ? "bg-brand-600" : "bg-ink-200",
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
