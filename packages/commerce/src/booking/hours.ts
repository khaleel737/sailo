/**
 * When a shop is open, as the seller describes it.
 *
 * Seven days, each holding any number of windows, so a shop that closes for
 * lunch says so rather than being forced into one block. Stored as jsonb and
 * therefore arriving from the database as `unknown` — a row written by an
 * older build, or by hand, has to be refused rather than trusted, which is
 * what `isWeeklyHours` is for.
 *
 * Times are wall-clock in the shop's own zone. They carry no offset on
 * purpose: "we open at nine" stays true across a daylight-saving change, and
 * an instant would not.
 */

// The stored shape lives with the schema that persists it.
import type { OpeningWindow, WeeklyHours } from "@sailo/db/schema";
// Only `WeeklyHours` is re-exported: callers that persist opening hours read it
// from here. `OpeningWindow` is used just below to type-guard a stored window,
// and anything that needs the type itself takes it from @sailo/db/schema.
export type { WeeklyHours };

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/** Minutes from midnight, or null when the text is not a clock time. */
export function minutesOfDay(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;

  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** `540` back to `09:00`, so a stored window round-trips into a form. */
export function clockTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.trunc(minutes)));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

function isWindow(value: unknown): value is OpeningWindow {
  if (typeof value !== "object" || value === null) return false;
  const w = value as Partial<OpeningWindow>;
  const from = minutesOfDay(w.from);
  const to = minutesOfDay(w.to);
  // A window that ends when it starts, or before, sells nothing.
  return from !== null && to !== null && to > from;
}

export function isWeeklyHours(value: unknown): value is WeeklyHours {
  return (
    Array.isArray(value) &&
    value.length === 7 &&
    value.every((day) => Array.isArray(day) && day.every(isWindow))
  );
}

/**
 * Puts a seller's windows in order and merges the ones that touch.
 *
 * Two overlapping windows would otherwise generate the same slot twice, and a
 * buyer would see nine o'clock listed two or three times. Merging at the edge
 * means the rest of the system can assume windows are disjoint and sorted.
 */
export function normalizeWeeklyHours(value: unknown): WeeklyHours {
  const source: unknown[] = Array.isArray(value) ? value : [];

  return Array.from({ length: 7 }, (_, day) => {
    const raw = Array.isArray(source[day]) ? (source[day] as unknown[]) : [];

    const spans = raw
      .filter(isWindow)
      .map((w) => ({
        from: minutesOfDay(w.from) as number,
        to: minutesOfDay(w.to) as number,
      }))
      .toSorted((a, b) => a.from - b.from || a.to - b.to);

    const merged: { from: number; to: number }[] = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      // `>=` rather than `>`: 09:00–12:00 and 12:00–17:00 are one window, and
      // leaving them apart would produce a slot boundary that isn't real.
      if (last && span.from <= last.to) {
        last.to = Math.max(last.to, span.to);
      } else {
        merged.push({ ...span });
      }
    }

    return merged.map((s) => ({ from: clockTime(s.from), to: clockTime(s.to) }));
  });
}

/** Weekdays nine to five — what a shop gets before anyone opens the setting. */
export const DEFAULT_WEEKLY_HOURS: WeeklyHours = [
  [],
  [{ from: "09:00", to: "17:00" }],
  [{ from: "09:00", to: "17:00" }],
  [{ from: "09:00", to: "17:00" }],
  [{ from: "09:00", to: "17:00" }],
  [{ from: "09:00", to: "17:00" }],
  [],
];

/**
 * The week a shop actually keeps, from whatever jsonb handed back.
 *
 * Null is a shop that never opened the setting, and gets the default. Anything
 * else is a row this build cannot read, and gets normalised rather than
 * dropped — an empty week silently sells nothing and reads as a broken
 * calendar rather than a closed shop.
 */
export function hoursOf(stored: unknown): WeeklyHours {
  // Null is the only "not configured" value; a seller who closed every day
  // meant it, and must not be handed the default back.
  if (stored === null || stored === undefined) return DEFAULT_WEEKLY_HOURS;

  /*
   * Always normalised, never returned as stored even when it validates.
   * `isWeeklyHours` checks each window on its own, so two that overlap pass it
   * — and the slot generator assumes windows are disjoint and in order, which
   * is a guarantee only normalising provides. Idempotent, so a week already in
   * that shape comes back unchanged.
   */
  return normalizeWeeklyHours(stored);
}

/** True when no day has a window, which means the shop takes no bookings. */
export function isClosedAllWeek(hours: WeeklyHours): boolean {
  return hours.every((day) => day.length === 0);
}
