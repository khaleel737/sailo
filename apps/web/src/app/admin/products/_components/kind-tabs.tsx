"use client";

import { useRef } from "react";
import {
  CalendarDays,
  ClipboardList,
  CloudDownload,
  Package,
  Repeat,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@sailo/design-system/web/cn";
import { PRODUCT_KIND_VALUES, type ProductKind } from "@sailo/core/variants";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * What the seller is selling — the decision the rest of the form hangs off.
 *
 * It was a `<select>` sitting fifth in the form, between the price and the
 * category, and the fields it governs appeared further down the page where a
 * seller who never scrolled past Options never met them. Two consequences, and
 * both were reported as bugs rather than as design: events saved without a
 * start time because the seller had not seen the field, and memberships saved
 * without a billing interval for the same reason.
 *
 * A tablist fixes the ordering as well as the affordance. The choice is now
 * the first thing on the page, five things are visibly on offer where a
 * collapsed `<select>` advertised none of them, and the panel underneath is
 * plainly *this tab's*. Nothing else about the form moved.
 *
 * ONE, STRUCTURALLY
 *
 * Exclusivity is not enforced by a rule anybody could forget — it is a single
 * `ProductKind` in the parent's state, and the panel renders the cards for
 * that one value. There is no arrangement of clicks that produces two, and
 * more importantly there is no arrangement that *posts* two: the inactive
 * panels are not rendered at all, so their inputs are not in the DOM and
 * cannot reach the `FormData`. A hidden panel with `display: none` would still
 * have submitted an event's start time on a physical product.
 *
 * KEYBOARD
 *
 * The APG tabs pattern, with automatic activation: arrows move the selection
 * and the focus together, Home and End jump to the ends. Automatic rather than
 * manual activation because switching panels here costs nothing — no fetch, no
 * navigation — and a seller arrowing along the row wants to see each kind as
 * they pass it.
 */

type KindMeta = { value: ProductKind; icon: LucideIcon };

/**
 * Icons, in the same order `PRODUCT_KIND_VALUES` is in — derived from it below
 * rather than written out again, so a sixth kind is a compile error here
 * instead of a tab that quietly never renders.
 */
const ICONS: Record<ProductKind, LucideIcon> = {
  physical: Package,
  digital: CloudDownload,
  service: CalendarDays,
  event: Ticket,
  membership: Repeat,
  lead: ClipboardList,
};

const KINDS: KindMeta[] = PRODUCT_KIND_VALUES.map((value) => ({
  value,
  icon: ICONS[value],
}));

/** The id the panel underneath carries, so `aria-controls` can point at it. */
export const KIND_PANEL_ID = "product-kind-panel";

const tabId = (kind: ProductKind) => `product-kind-tab-${kind}`;

export function KindTabs({
  value,
  onChange,
}: {
  value: ProductKind;
  onChange: (kind: ProductKind) => void;
}) {
  const a = useAdminT();
  const listRef = useRef<HTMLDivElement>(null);

  const labels: Record<ProductKind, string> = {
    physical: a.productForm.kindPhysicalLabel,
    digital: a.productForm.kindDigitalLabel,
    service: a.productForm.kindServiceLabel,
    event: a.productForm.kindEventLabel,
    membership: a.productForm.kindMembershipLabel,
    lead: a.productForm.kindLeadLabel,
  };

  const blurbs: Record<ProductKind, string> = {
    physical: a.productForm.physicalHint,
    digital: a.productForm.digitalHint,
    service: a.productForm.serviceHint,
    event: a.productForm.eventHint,
    membership: a.productForm.membershipHint,
    lead: a.productForm.leadHint,
  };

  /** Moves selection and focus together, and wraps at both ends. */
  function move(delta: number) {
    const index = KINDS.findIndex((k) => k.value === value);
    const next = KINDS[(index + delta + KINDS.length) % KINDS.length];
    if (!next) return;
    onChange(next.value);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(next.value))}`)
      ?.focus();
  }

  function jumpTo(kind: ProductKind) {
    onChange(kind);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(kind))}`)
      ?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      /*
       * Right and left rather than end and start, because the row reverses
       * under RTL and the arrow that visually moves "onward" has to be the one
       * that selects onward. `dir` is on the document, so the row's own
       * computed direction is the honest answer.
       */
      case "ArrowRight":
      case "ArrowLeft": {
        event.preventDefault();
        const rtl =
          typeof window !== "undefined" && listRef.current
            ? getComputedStyle(listRef.current).direction === "rtl"
            : false;
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
        const first = KINDS[0];
        if (first) jumpTo(first.value);
        break;
      }
      case "End": {
        event.preventDefault();
        const last = KINDS[KINDS.length - 1];
        if (last) jumpTo(last.value);
        break;
      }
      default:
        break;
    }
  }

  return (
    <div>
      {/*
        The value the server reads. A `<button>` posts nothing, and the tabs
        are buttons because a radio group cannot own `aria-selected` or the
        roving tabindex the pattern needs.
      */}
      <input type="hidden" name="kind" value={value} />

      <div
        ref={listRef}
        role="tablist"
        aria-label={a.productForm.kind}
        /*
         * Wraps rather than scrolls on a narrow screen.
         *
         * It scrolled first, and three tiles filled a phone exactly — so
         * Event and Membership sat past the right edge with nothing peeking
         * to say they were there. A seller who never swiped would have
         * concluded this shop cannot sell tickets. Three by two costs one row
         * of height and puts all five kinds on the screen at once, which is
         * the entire job of showing them as tiles instead of a `<select>`.
         */
        className="grid grid-cols-3 gap-2 sm:grid-cols-5"
      >
        {KINDS.map(({ value: kind, icon: Icon }) => {
          const active = kind === value;
          return (
            <button
              key={kind}
              id={tabId(kind)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={KIND_PANEL_ID}
              /* Roving tabindex: one stop for the whole row, arrows inside it. */
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(kind)}
              /*
               * On the tab rather than on the row. Delegating from the
               * container worked — the focused element is always a tab — but
               * a container with a key handler and no way to receive focus is
               * a thing a keyboard user can be told about and never reach, so
               * the handler belongs on the element that actually has focus.
               */
              onKeyDown={onKeyDown}
              className={cn(
                "focus-ring group flex flex-col items-center gap-2",
                "rounded-2xl border px-2 py-3.5 text-center sm:px-3",
                "transition-[background-color,border-color,box-shadow,color] duration-200",
                active
                  ? "border-brand-600/25 bg-brand-50 shadow-xs"
                  : "border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-9 items-center justify-center rounded-xl transition-colors duration-200",
                  active
                    ? "bg-brand-600 text-white"
                    : "bg-ink-100 text-ink-500 group-hover:text-ink-700",
                )}
              >
                <Icon className="size-[18px]" strokeWidth={2} />
              </span>
              <span
                className={cn(
                  "text-[13px] font-medium leading-none transition-colors duration-200",
                  active ? "text-brand-800" : "text-ink-600",
                )}
              >
                {labels[kind]}
              </span>
            </button>
          );
        })}
      </div>

      {/*
        What the chosen kind means, in one line. It used to sit below the price
        card as a paragraph that changed under the seller without anything
        pointing at it; here it is plainly the description of the lit tab.

        `aria-live` is deliberately absent: the tab's own `aria-selected` is
        already announced on arrow, and a second announcement of the same
        change is noise rather than help.
      */}
      <p className="mt-3 text-xs leading-relaxed text-ink-500">{blurbs[value]}</p>
    </div>
  );
}
