/**
 * "2 minutes ago", until that stops being the useful answer.
 *
 * This and `orderTone` were exported from `app/(tabs)/orders/index.tsx`, and the file said
 * exactly why: *"every file under `app/` is a route… the ordinary home for a shared helper is
 * `apps/mobile/components/`, which this work order does not own."* It does now. Three screens
 * imported these from a screen; they import a component module instead.
 */

import { useMemo } from "react";

export const DAY_MS = 86_400_000;
/** How old something gets before a relative time stops being the useful answer. */
export const RELATIVE_LIMIT = 7 * DAY_MS;

/**
 * "2h ago", in the seller's language.
 *
 * **Nothing here ticks.** A clock that re-rendered the list every minute would
 * repaint every row to change one word an hour, and on a phone that is a scroll
 * which stutters for no reason the seller can see. The caller passes the
 * instant it is measuring from — one `Date.now()` per render pass, shared by
 * every row — so the labels agree with each other and refresh when the screen
 * has a reason to: a refetch, a pull, or coming back to the app.
 *
 * `Intl.RelativeTimeFormat` is *not* assumed. Hermes ships a narrower ICU than
 * a browser's and has had partial `Intl` historically, which is the same
 * caution `@sailo/core/currency` takes around `NumberFormat`. Both formatters
 * are built inside a `try`, and the fallback is an absolute date — a truthful
 * answer, where a hand-rolled "2h ago" in English for an Arabic seller would
 * not be. Anything older than a week gets the date regardless: "43 days ago" is
 * arithmetic the reader has to undo.
 */
export function useRelativeTime(locale: string): (iso: string, now: number) => string {
  return useMemo(() => {
    let relative: Intl.RelativeTimeFormat | null = null;
    let absolute: Intl.DateTimeFormat | null = null;
    try {
      relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    } catch {
      relative = null;
    }
    try {
      absolute = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    } catch {
      absolute = null;
    }

    return (iso: string, now: number) => {
      const then = new Date(iso).getTime();
      if (Number.isNaN(then)) return "";

      // Negative into the past, which is the sign `RelativeTimeFormat` wants.
      const signed = then - now;
      const distance = Math.abs(signed);

      if (!relative || distance >= RELATIVE_LIMIT) {
        /*
         * The ISO slice is a last resort rather than a format choice: the one
         * time it is reached is when this runtime has no `Intl` at all, and
         * `2026-08-14` is at least unambiguous in every locale on earth.
         */
        return absolute ? absolute.format(then) : new Date(then).toISOString().slice(0, 10);
      }
      if (distance < 60_000) return relative.format(Math.round(signed / 1_000), "second");
      if (distance < 3_600_000) return relative.format(Math.round(signed / 60_000), "minute");
      if (distance < DAY_MS) return relative.format(Math.round(signed / 3_600_000), "hour");
      return relative.format(Math.round(signed / DAY_MS), "day");
    };
  }, [locale]);
}
