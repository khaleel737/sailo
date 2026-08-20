import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

/** Status: badge, status dot, alert, empty state, stat, skeleton, spinner. */

/* --------------------------------------------------------------------------
   Status
-------------------------------------------------------------------------- */

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "brand";

const BADGE_TONES: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-900",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-800",
  brand: "bg-brand-100 text-brand-900",
};

const DOT_TONES: Record<Tone, string> = {
  neutral: "bg-ink-400",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  brand: "bg-brand-600",
};

export function Badge({
  className,
  tone = "neutral",
  dot = false,
  children,
  ...props
}: React.ComponentProps<"span"> & {
  tone?: Tone;
  /** Adds a leading status dot — use it when the badge reports live state. */
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        /*
         * `whitespace-nowrap`, because a badge is a label and not prose. In a
         * narrow table column "Needs evidence" wrapped onto two lines and took
         * the whole row's height with it — so a table of twenty-five payments
         * had twenty-five rows of two different heights for no reason anybody
         * could see. A chip that does not fit should make its column wider, not
         * make itself taller.
         */
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span className={cn("size-1.5 rounded-full", DOT_TONES[tone])} />
      ) : null}
      {children}
    </span>
  );
}

const ALERT_TONES = {
  error: "border-red-200 bg-red-50 text-red-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-blue-200 bg-blue-50 text-blue-800",
} as const;

export function Alert({
  tone = "error",
  title,
  icon,
  children,
  className,
}: {
  tone?: keyof typeof ALERT_TONES;
  title?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  if (!children && !title) return null;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "animate-fade flex gap-3 rounded-xl border px-3.5 py-3 text-sm",
        ALERT_TONES[tone],
        className,
      )}
    >
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? (
          <div className={cn("leading-relaxed", title && "mt-0.5 opacity-90")}>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  art,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  /**
   * A drawing instead of an icon chip — see `empty-art.tsx`. A first visit
   * deserves a picture of the thing it's about to have; when both are given,
   * the drawing wins.
   */
  art?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "animate-rise flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-ink-50/50 px-6 py-16 text-center",
        className,
      )}
    >
      {art ? (
        <div className="mb-4">{art}</div>
      ) : icon ? (
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-white text-ink-400 shadow-xs ring-1 ring-ink-200">
          {icon}
        </div>
      ) : null}
      <p className="font-semibold text-ink-900">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/**
 * A single headline number. Grouped three or four across on a dashboard.
 *
 * Icon and label sit together on one line rather than pushed to opposite
 * edges — the icon labels the metric, so it belongs beside the words, and a
 * row of tiles then shares one left margin instead of four ragged ones. Same
 * shape HQ's `Metric` uses, so the two dashboards read as one product.
 */
export function Stat({
  label,
  value,
  hint,
  delta,
  icon,
  chart,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** The one qualifier that stops the number being misread. */
  hint?: React.ReactNode;
  /** Signed change against the previous period, already formatted. */
  delta?: { value: string; direction: "up" | "down" | "flat" };
  icon?: React.ReactNode;
  /** A sparkline under the figure — see `sparkline.tsx`. Decorative. */
  chart?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-ink-200 bg-white p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-ink-400">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="tabular mt-2 text-2xl font-semibold text-ink-900">{value}</p>
      {delta ? (
        <p
          className={cn(
            "tabular mt-1 text-xs font-medium",
            delta.direction === "up"
              ? "text-emerald-600"
              : delta.direction === "down"
                ? "text-red-600"
                : "text-ink-400",
          )}
        >
          {delta.value}
        </p>
      ) : null}
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
      {chart ? <div className="mt-2">{chart}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

/** Thin determinate bar — upload progress, plan usage, step position. */
