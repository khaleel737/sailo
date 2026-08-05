import * as React from "react";
import { cn } from "@/lib/utils";

/** Form controls: input, textarea, select, label, field, checkbox, switch. */

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
      {/* ink-400 measures 2.99:1 against both the app surface and brand paper,
          under AA. ink-500 is 5.11 and still reads as secondary. */}
      {hint ? (
        <span className="ms-1.5 font-normal text-ink-500">{hint}</span>
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
  action,
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
  /** Sits opposite the label — a link or control about this field alone. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {action ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {/* The row owns the gap to the input now, so the label gives up its own. */}
          <Label htmlFor={htmlFor} hint={hint} className="mb-0">
            {label}
          </Label>
          {action}
        </div>
      ) : (
        <Label htmlFor={htmlFor} hint={hint}>
          {label}
        </Label>
      )}
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
