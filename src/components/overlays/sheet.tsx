"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Backdrop, CloseButton, createPortal, useModalLayer } from "./modal-layer";

export function Sheet({
  open,
  onClose,
  title,
  description,
  header,
  footer,
  side = "end",
  closeLabel = "Close",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  /** Extra row under the title — filters, a total, a step counter. */
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /** `end` is the right edge in English and the left in Arabic. */
  side?: "end" | "bottom";
  closeLabel?: string;
  children?: React.ReactNode;
}) {
  const ref = useModalLayer(open, onClose);
  const titleId = React.useId();

  if (!open) return null;

  const sideSheet = side === "end";

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex",
        sideSheet ? "justify-end" : "items-end justify-center",
      )}
    >
      <Backdrop onClose={onClose} label={closeLabel} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative flex w-full flex-col bg-white shadow-xl",
          sideSheet
            ? "animate-sheet-up sm:animate-sheet-in max-h-[94vh] rounded-t-3xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none"
            : "animate-sheet-up max-h-[94vh] rounded-t-3xl sm:max-w-lg sm:rounded-t-3xl",
        )}
      >
        <div
          aria-hidden
          className={cn(
            "mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-ink-200",
            sideSheet && "sm:hidden",
          )}
        />

        <div className="shrink-0 px-5 pt-4 pb-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className="text-base font-semibold tracking-tight text-ink-900"
              >
                {title}
              </h2>
              {description ? (
                <p className="mt-0.5 text-sm text-ink-500">{description}</p>
              ) : null}
            </div>
            <CloseButton onClose={onClose} label={closeLabel} className="-me-2 -mt-1" />
          </div>
          {header ? <div className="mt-3">{header}</div> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-ink-200 px-5 py-4">
          {children}
        </div>

        {footer ? (
          <div className="shrink-0 border-t border-ink-200 bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------------------------------------------------
   Panel — inline disclosure. The summary row always states the thing's status
   so the page can be read without opening anything.

   A closed Panel UNMOUNTS its children. That is what keeps a page of twenty
   rails cheap, but it means a Panel must never hold part of a form that
   submits from outside it — collapsed fields would silently drop out of the
   FormData. Give each Panel its own <form>, the way the payment rails do.
-------------------------------------------------------------------------- */
