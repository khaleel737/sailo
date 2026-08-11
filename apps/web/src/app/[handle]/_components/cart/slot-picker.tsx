"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Picking an appointment from what the shop is actually offering.
 *
 * Replaces a bare `datetime-local`, which asked the buyer to guess: it
 * accepted three in the morning, it accepted a Sunday on a shop that closes
 * at weekends, and two buyers could type the same time. What it could not do
 * is show availability, because the browser has no idea what the shop's week
 * looks like.
 *
 * The list is advisory. `createOrderIntent` re-derives it server-side before
 * writing anything — this is a snapshot, and someone else may book between the
 * fetch and the order.
 */

type Day = { date: string; slots: string[] };
type Calendar = { timeZone: string; durationMinutes: number | null; days: Day[] };

export type SlotPickerCopy = {
  label: string;
  hint: string;
  loading: string;
  noneToday: string;
  noneAtAll: string;
  failed: string;
  clear: string;
};

/** `2026-08-07` → the day and date, written in the buyer's own language. */
function dayLabel(date: string, locale: string | undefined) {
  // Noon, so a zone behind UTC cannot roll the label back a day.
  const at = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(at);
}

function timeLabel(iso: string, locale: string | undefined, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function SlotPicker({
  productId,
  value,
  onChange,
  locale,
  copy,
}: {
  productId: string;
  /** The chosen slot as an ISO instant, or "" for none. */
  value: string;
  onChange: (iso: string) => void;
  locale: string | undefined;
  copy: SlotPickerCopy;
}) {
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [failed, setFailed] = useState(false);
  const [openDate, setOpenDate] = useState<string | null>(null);

  /*
   * Clearing last service's times when the product changes, during render
   * rather than from the effect below.
   *
   * The effect ran after this component had already been painted once with
   * the previous service's slots under the new service's name — a buyer could
   * see, and click, a time that belongs to something they are no longer
   * buying. Adjusting here means React discards that render before anyone
   * sees it, and there is no second pass to schedule.
   *
   * Kept in the component rather than solved with a `key` at the two call
   * sites: a third one added later would silently reintroduce the bug.
   */
  const [shownFor, setShownFor] = useState(productId);
  if (shownFor !== productId) {
    setShownFor(productId);
    setCalendar(null);
    setFailed(false);
    setOpenDate(null);
  }

  useEffect(() => {
    // Aborted on unmount and on a product change, so a slow answer for the
    // previous service cannot land in this one's list.
    const abort = new AbortController();

    fetch(`/api/booking/${productId}?days=14`, { signal: abort.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("unavailable"))))
      .then((data: Calendar) => {
        setCalendar(data);
        // Open the first day that has anything, so the common case needs no
        // clicks at all.
        setOpenDate(data.days.find((d) => d.slots.length > 0)?.date ?? null);
        return data;
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setFailed(true);
      });

    return () => abort.abort();
  }, [productId]);

  const days = calendar?.days ?? [];
  const bookable = days.filter((d) => d.slots.length > 0);
  const active = bookable.find((d) => d.date === openDate) ?? bookable[0];

  return (
    <div className="surface-elevated rounded-xl p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
        <CalendarClock className="size-4" />
        {copy.label}
      </div>

      {failed ? (
        <p className="text-muted text-xs leading-relaxed">{copy.failed}</p>
      ) : !calendar ? (
        <p className="text-muted flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          {copy.loading}
        </p>
      ) : bookable.length === 0 ? (
        <p className="text-muted text-xs leading-relaxed">{copy.noneAtAll}</p>
      ) : (
        <>
          {/* Dates first: a buyer picks a day, then a time within it. */}
          <div
            className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1"
            role="tablist"
            aria-label={copy.label}
          >
            {bookable.map((day) => {
              const isOpen = day.date === active?.date;
              return (
                <button
                  key={day.date}
                  type="button"
                  role="tab"
                  aria-selected={isOpen}
                  onClick={() => setOpenDate(day.date)}
                  className={cn(
                    "focus-ring shrink-0 rounded-lg px-3 py-2 text-xs whitespace-nowrap transition",
                    "pointer-coarse:min-h-11",
                    isOpen
                      ? "bg-ink-900 font-medium text-white"
                      : "surface-card text-ink-700 hover:bg-ink-50",
                  )}
                >
                  {dayLabel(day.date, locale)}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(active?.slots ?? []).map((iso) => {
              const chosen = iso === value;
              return (
                <button
                  key={iso}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => onChange(chosen ? "" : iso)}
                  className={cn(
                    "focus-ring rounded-lg px-3 py-2 text-sm tabular-nums transition",
                    "pointer-coarse:min-h-11",
                    chosen
                      ? "bg-brand-700 font-medium text-white"
                      : "surface-card text-ink-800 hover:bg-ink-50",
                  )}
                >
                  {timeLabel(iso, locale, calendar.timeZone)}
                </button>
              );
            })}
            {active && active.slots.length === 0 ? (
              <p className="text-muted text-xs">{copy.noneToday}</p>
            ) : null}
          </div>

          <p className="text-muted mt-2 text-xs leading-relaxed">
            {copy.hint}
            {/* Named explicitly: a buyer in another country needs to know the
                time is the shop's, not theirs. */}
            {calendar.timeZone ? ` (${calendar.timeZone.replace(/_/g, " ")})` : ""}
          </p>
        </>
      )}
    </div>
  );
}
