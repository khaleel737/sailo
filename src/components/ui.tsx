import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ===========================================================================
   Sailo UI primitives — the server-safe half of the kit.

   Anything that needs state (Dialog, Sheet, Panel, SegmentedControl) lives in
   `@/components/overlays` so that importing a Button never drags a client
   bundle along with it.

   ---------------------------------------------------------------------------
   Which container does a thing open in?

     Panel   an inline disclosure inside the page. The content belongs to the
             row it sits under and the surrounding page stays readable while
             it is open. Payment rails, delivery rates, settings groups.

     Dialog  a centred modal that blocks. One decision, or one short form,
             that has to be resolved before anything else continues. Confirm
             a delete, pick a plan, name a new thing.

     Sheet   a drawer on the edge — bottom on phones, side on desktop. A flow
             with its own scroll that stays attached to what opened it. Cart,
             checkout, an order's detail.

   If you are reaching for a Dialog and the form has more than about six
   fields, it wants to be a Sheet. If it would still make sense with the page
   visible behind it, it wants to be a Panel.
   ---------------------------------------------------------------------------

   Button intent, so the page has one obvious next move:

     primary   the workhorse commit inside the admin — ink, not brand.
     brand     the money moment. Create the shop, publish, upgrade. Green.
     secondary an equal-weight alternative sitting beside a primary.
     ghost     navigation and dismissal.
     danger    destroys something.
=========================================================================== */

type ButtonVariant =
  | "primary"
  | "brand"
  | "secondary"
  | "ghost"
  | "subtle"
  | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-ink-900 text-white shadow-xs hover:bg-ink-800 active:bg-ink-950 disabled:bg-ink-300",
  brand:
    "bg-brand-700 text-white shadow-xs hover:bg-brand-600 active:bg-brand-800 disabled:bg-brand-700/40",
  secondary:
    "border border-ink-200 bg-white text-ink-900 shadow-xs hover:border-ink-300 hover:bg-ink-50 active:bg-ink-100",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200",
  subtle: "bg-ink-100 text-ink-800 hover:bg-ink-200 active:bg-ink-300",
  danger:
    "bg-red-600 text-white shadow-xs hover:bg-red-700 active:bg-red-800 disabled:bg-red-300",
};

const BUTTON_SIZES = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-6 text-[0.9375rem]",
  icon: "size-10 gap-0",
  "icon-sm": "size-8 gap-0",
} as const;

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
  /** Swaps the leading slot for a spinner and blocks re-submission. */
  loading?: boolean;
}) {
  return (
    <button
      className={cn(
        "focus-ring press inline-flex shrink-0 items-center justify-center rounded-xl font-medium",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-150",
        "disabled:pointer-events-none disabled:opacity-60",
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
      {children}
    </button>
  );
}

/* --------------------------------------------------------------------------
   Form controls
-------------------------------------------------------------------------- */

/** Shared shell so an input, a select and a textarea line up to the pixel. */
const CONTROL = [
  "w-full rounded-xl border bg-white text-sm text-ink-900 shadow-xs",
  "border-ink-200 placeholder:text-ink-400",
  "transition-[border-color,box-shadow] duration-150",
  "hover:border-ink-300",
  "focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/12",
  "disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400",
  "aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-red-500/12",
].join(" ");

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(CONTROL, "h-11 px-3.5", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(CONTROL, "min-h-20 px-3.5 py-2.5 leading-relaxed", className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(CONTROL, "select-chevron h-11", className)} {...props} />
  );
}

/**
 * Prefixed input — for the things that are always read with something in
 * front of them, like a handle after a domain.
 */
export function InputGroup({
  prefix,
  className,
  children,
}: {
  prefix: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center rounded-xl border border-ink-200 bg-white shadow-xs",
        "transition-[border-color,box-shadow] duration-150",
        "focus-within:border-brand-600 focus-within:ring-4 focus-within:ring-brand-600/12",
        className,
      )}
    >
      <span className="ps-3.5 text-sm text-ink-400 select-none">{prefix}</span>
      {children}
    </div>
  );
}

export function Label({
  className,
  children,
  hint,
  ...props
}: React.ComponentProps<"label"> & { hint?: string }) {
  return (
    <label
      className={cn("mb-1.5 block text-sm font-medium text-ink-800", className)}
      {...props}
    >
      {children}
      {hint ? (
        <span className="ms-1.5 font-normal text-ink-400">{hint}</span>
      ) : null}
    </label>
  );
}

export function Field({
  label,
  hint,
  help,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  /** Guidance shown before anything goes wrong. */
  help?: string;
  /** Replaces `help` once it is set, and colours the row. */
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>
      ) : help ? (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{help}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      className={cn(
        "focus-ring size-4.5 shrink-0 rounded-md border-ink-300 text-brand-700",
        "accent-brand-700 transition",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Switch — for settings that take effect on their own, where a checkbox would
 * imply "and then press Save".
 */
export function Switch({
  className,
  label,
  description,
  ...props
}: React.ComponentProps<"input"> & {
  label: React.ReactNode;
  description?: string;
}) {
  return (
    <label
      className={cn(
        "group flex cursor-pointer items-start gap-3",
        props.disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input type="checkbox" className="peer sr-only" {...props} />
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 h-6 w-10 shrink-0 rounded-full bg-ink-200 transition-colors duration-200",
          "peer-checked:bg-brand-700",
          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600",
          "after:absolute after:start-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow-sm",
          "after:transition-transform after:duration-200 after:ease-[var(--ease-out-quint)]",
          "peer-checked:after:translate-x-4 rtl:peer-checked:after:-translate-x-4",
        )}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink-900">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/* --------------------------------------------------------------------------
   Containers
-------------------------------------------------------------------------- */

export function Card({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-ink-200 bg-white shadow-sm",
        interactive && "lift cursor-pointer hover:border-ink-300",
        className,
      )}
      {...props}
    />
  );
}

/** Heading for a group of cards inside a page. */
export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("mb-3 flex flex-wrap items-end justify-between gap-3", className)}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-500">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

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
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
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

/**
 * A live/idle indicator. `pulse` is reserved for genuinely live things — a
 * rail that is taking orders right now — so the animation still means
 * something when you see it.
 */
export function StatusDot({
  tone = "neutral",
  pulse = false,
  className,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative flex size-2.5 shrink-0", className)}>
      {pulse ? (
        <span
          className={cn(
            "absolute inset-0 animate-ping rounded-full opacity-60",
            DOT_TONES[tone],
          )}
        />
      ) : null}
      <span
        className={cn("relative size-2.5 rounded-full", DOT_TONES[tone])}
      />
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
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
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
      {icon ? (
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

/** A single headline number. Grouped three or four across on a dashboard. */
export function Stat({
  label,
  value,
  delta,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Signed change against the previous period, already formatted. */
  delta?: { value: string; direction: "up" | "down" | "flat" };
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-ink-200 bg-white p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-500">{label}</p>
        {icon ? <span className="text-ink-300">{icon}</span> : null}
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
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

/** Thin determinate bar — upload progress, plan usage, step position. */
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
