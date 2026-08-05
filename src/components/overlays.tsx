"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ===========================================================================
   Overlays and disclosures.

   See the container rule in `@/components/ui`: Panel stays in the page,
   Dialog blocks it, Sheet slides in from an edge and owns its own scroll.
=========================================================================== */

/**
 * Everything a modal layer needs and nothing it doesn't: Escape closes, the
 * page behind stops scrolling, focus is trapped, and focus returns to whatever
 * opened it.
 */
function useModalLayer(open: boolean, onClose: () => void) {
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
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
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

function Backdrop({ onClose, label }: { onClose: () => void; label: string }) {
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

function CloseButton({
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

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "danger",
  pending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: "danger" | "primary";
  pending?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      closeLabel={cancelLabel}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring press h-10 rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium text-ink-900 transition hover:bg-ink-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={cn(
              "focus-ring press h-10 rounded-xl px-4 text-sm font-medium text-white transition disabled:opacity-60",
              tone === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-ink-900 hover:bg-ink-800",
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    />
  );
}
