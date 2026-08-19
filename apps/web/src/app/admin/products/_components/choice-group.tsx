"use client";

import { useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@sailo/design-system/web/cn";

/**
 * A row of buttons where exactly one is chosen.
 *
 * Two of these grew inside this form — how a digital product is delivered, and
 * how often a membership is charged — and both were hand-rolled as
 * `role="radio"` buttons that every Tab press stopped on. A radio group is one
 * tab stop with arrows inside it; three stops in a row of three is how a
 * keyboard user ends up pressing Tab nine times to cross a form.
 *
 * Not the kind tabs above it, on purpose. Those are a tablist because they
 * switch what the page is about; these choose a value inside a field, which is
 * a radio group. The keyboard behaviour is the same and now lives once.
 */

export type Choice<T extends string> = {
  value: T;
  label: string;
  /** A line under the label. Rendered by the `tile` variant only. */
  description?: string;
  icon?: LucideIcon;
};

export function ChoiceGroup<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  variant = "pill",
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly Choice<T>[];
  ariaLabel: string;
  /** `tile` carries an icon and a line of explanation; `pill` is a word. */
  variant?: "tile" | "pill";
  className?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);

  function focusValue(next: T) {
    onChange(next);
    groupRef.current
      ?.querySelector<HTMLButtonElement>(`[data-choice="${CSS.escape(next)}"]`)
      ?.focus();
  }

  function move(delta: number) {
    const index = options.findIndex((o) => o.value === value);
    const next = options[(index + delta + options.length) % options.length];
    if (next) focusValue(next.value);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowLeft": {
        event.preventDefault();
        // The row reverses under RTL, so the arrow that moves onward visually
        // has to be the one that selects onward.
        const rtl =
          groupRef.current !== null &&
          getComputedStyle(groupRef.current).direction === "rtl";
        const forward = event.key === "ArrowRight" ? 1 : -1;
        move(rtl ? -forward : forward);
        break;
      }
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home": {
        event.preventDefault();
        const first = options[0];
        if (first) focusValue(first.value);
        break;
      }
      case "End": {
        event.preventDefault();
        const last = options[options.length - 1];
        if (last) focusValue(last.value);
        break;
      }
      default:
        break;
    }
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      /*
       * The column count is a style, not a class. `grid-cols-${n}` reads fine
       * and generates nothing: Tailwind scans source text, so a class assembled
       * at runtime is never in the stylesheet and the row silently stacks.
       */
      style={
        variant === "pill"
          ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }
          : undefined
      }
      className={cn("grid gap-2", variant === "tile" && "sm:grid-cols-3", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-choice={option.value}
            /* One tab stop for the group; the arrows move inside it. */
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={onKeyDown}
            className={cn(
              "focus-ring rounded-xl border text-start",
              "transition-[background-color,border-color,box-shadow,color] duration-200",
              variant === "tile"
                ? "flex items-start gap-3 p-3"
                : "h-11 px-3 text-center text-sm font-medium",
              active
                ? "border-brand-600/25 bg-brand-50 shadow-xs"
                : "border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50",
              variant === "pill" && (active ? "text-brand-800" : "text-ink-600"),
            )}
          >
            {Icon ? (
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
                  active ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-500",
                )}
              >
                <Icon className="size-4" />
              </span>
            ) : null}

            {variant === "tile" ? (
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-[13px] font-medium",
                    active ? "text-brand-800" : "text-ink-800",
                  )}
                >
                  {option.label}
                </span>
                {option.description ? (
                  <span className="mt-0.5 block text-xs leading-snug text-ink-500">
                    {option.description}
                  </span>
                ) : null}
              </span>
            ) : (
              option.label
            )}
          </button>
        );
      })}
    </div>
  );
}
