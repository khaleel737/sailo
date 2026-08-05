"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The parts every modal layer shares.
 *
 * See the container rule in `@/components/ui`: Panel stays in the page,
 * Dialog blocks it, Sheet slides in from an edge and owns its own scroll.
 * What they have in common is here; what makes each one different is not.
 */

export { createPortal };

export function useModalLayer(open: boolean, onClose: () => void) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const opener = document.activeElement as HTMLElement | null;
    const { overflow, paddingInlineEnd } = document.body.style;

    // Removing the scrollbar shifts the layout unless its width is given back.
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingInlineEnd = `${gap}px`;

    const focusables = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    // Move focus in, so a screen reader lands inside the layer and Escape and
    // Tab both go where the user expects.
    queueMicrotask(() => (focusables()[0] ?? ref.current)?.focus());

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusables();
      // Both ends, tested together: a length check proves they exist to a
      // reader but not to the compiler, and the trap has nothing to cycle
      // between when either is missing.
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;

      if (e.shiftKey && (active === first || !ref.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      document.body.style.paddingInlineEnd = paddingInlineEnd;
      opener?.focus?.();
    };
  }, [open, onClose]);

  return ref;
}

export function Backdrop({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClose}
      tabIndex={-1}
      className="animate-backdrop absolute inset-0 bg-ink-950/45 backdrop-blur-[2px]"
    />
  );
}

export function CloseButton({
  onClose,
  label,
  className,
}: {
  onClose: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      className={cn(
        "focus-ring press flex size-9 shrink-0 items-center justify-center rounded-xl",
        "text-ink-500 transition hover:bg-ink-100 hover:text-ink-900",
        className,
      )}
    >
      <X className="size-5" />
    </button>
  );
}

/* --------------------------------------------------------------------------
   Dialog — one decision, blocking. Full-width sheet on phones, centred card
   above that, because a centred card on a small screen is a scroll trap.
-------------------------------------------------------------------------- */
