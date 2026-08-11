"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  subtitle,
  status,
  icon,
  defaultOpen = false,
  tone = "default",
  children,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Badges and dots — whatever tells you the state at a glance. */
  status?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  /** `active` tints the whole row, so a live rail is visible while scrolling. */
  tone?: "default" | "active";
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const bodyId = React.useId();

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border shadow-sm transition-colors duration-200",
        tone === "active"
          ? "border-brand-200 bg-brand-50/40"
          : "border-ink-200 bg-white",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className={cn(
          "focus-ring flex w-full items-center gap-3 p-4 text-start transition-colors",
          tone === "active" ? "hover:bg-brand-50" : "hover:bg-ink-50",
        )}
      >
        {icon ? (
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl border",
              tone === "active"
                ? "border-brand-200 bg-white text-brand-700"
                : "border-ink-200 bg-ink-50 text-ink-500",
            )}
          >
            {icon}
          </span>
        ) : null}

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink-900">{title}</span>
            {status}
          </span>
          {subtitle ? (
            <span className="mt-1 block text-xs leading-relaxed text-ink-500">
              {subtitle}
            </span>
          ) : null}
        </span>

        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-ink-400 transition-transform duration-300 ease-[var(--ease-out-quint)]",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          id={bodyId}
          className="animate-rise border-t border-ink-200 bg-white p-4"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------
   SegmentedControl — two to four mutually exclusive views. The thumb is a
   single moving element rather than a per-option background, so switching
   reads as one motion.
-------------------------------------------------------------------------- */
