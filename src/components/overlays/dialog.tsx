"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Backdrop, CloseButton, createPortal, useModalLayer } from "./modal-layer";

export function Dialog({
  open,
  onClose,
  title,
  description,
  eyebrow,
  footer,
  size = "md",
  closeLabel = "Close",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  /** Small line above the title — a lock chip, a plan name, a category. */
  eyebrow?: React.ReactNode;
  /** Pinned under the body; the action row lives here. */
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  closeLabel?: string;
  children?: React.ReactNode;
}) {
  const ref = useModalLayer(open, onClose);
  const titleId = React.useId();

  if (!open) return null;

  // Portalled to <body>: an ancestor with backdrop-filter, filter or transform
  // becomes the containing block for position:fixed, which would otherwise
  // anchor this to a sticky header instead of the viewport.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <Backdrop onClose={onClose} label={closeLabel} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "animate-sheet-up sm:animate-pop relative flex max-h-[92vh] w-full flex-col",
          "rounded-t-3xl bg-white shadow-xl sm:rounded-3xl",
          { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-3xl" }[size],
        )}
      >
        {/* Grab handle — the affordance that says this can be flicked away. */}
        <div
          aria-hidden
          className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-ink-200 sm:hidden"
        />

        <div className="flex items-start gap-3 px-6 pt-5 sm:pt-6">
          <div className="min-w-0 flex-1">
            {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
            <h2
              id={titleId}
              className="text-lg font-semibold tracking-tight text-ink-900"
            >
              {title}
            </h2>
            {description ? (
              <div className="mt-1 text-sm leading-relaxed text-ink-600">
                {description}
              </div>
            ) : null}
          </div>
          <CloseButton onClose={onClose} label={closeLabel} className="-me-2" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ink-200 px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------------------------------------------------
   Sheet — a flow with its own scroll, anchored to an edge.
-------------------------------------------------------------------------- */
