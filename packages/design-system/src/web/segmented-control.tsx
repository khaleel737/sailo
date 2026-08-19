"use client";

import * as React from "react";
import { cn } from "./cn";
import { Dialog } from "./dialog";
import { Button } from "./button";

/**
 * A row of mutually exclusive choices.
 *
 * Filed under overlays for a while, which it never was — nothing about it
 * covers the page. It is a control, and it belongs with the others.
 */

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  ariaLabel,
}: {
  options: readonly { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-grid rounded-xl border border-ink-200 bg-ink-50 p-1",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 start-1 rounded-lg bg-white shadow-xs transition-transform duration-300 ease-[var(--ease-out-quint)]"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(calc(${index} * 100% * var(--sheet-dir, 1)))`,
        }}
      />
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "focus-ring relative z-10 rounded-lg font-medium transition-colors duration-200",
              size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-3.5 text-sm",
              active ? "text-ink-900" : "text-ink-500 hover:text-ink-800",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------
   ConfirmDialog — the standard shape for "are you sure".
-------------------------------------------------------------------------- */

/**
 * A destructive act, stated and confirmed in one place.
 *
 * A bare submit button on a row deletes on a mis-tap; a browser `confirm()`
 * shows the visitor chrome no design system reaches. This is a Dialog with the
 * two buttons every "are you sure" needs, and nothing else — the caller says
 * what is about to happen and owns the action that does it.
 *
 * `onConfirm` may be async; the confirm button shows its spinner and blocks a
 * second press until it settles. The dialog stays open on failure so the
 * caller's error has somewhere to render.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone = "danger",
  pending = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** `danger` for deletion; `primary` for a consequential but safe act. */
  tone?: "danger" | "primary";
  /** Disables both buttons while the caller's action is in flight. */
  pending?: boolean;
  onConfirm: () => void;
  /** Extra content under the body — an error, a detail worth restating. */
  children?: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={body}
      size="sm"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            loading={pending}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
