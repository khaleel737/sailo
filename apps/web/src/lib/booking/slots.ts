import {
  addDays,
  toIsoDate,
  zonedParts,
  zonedTimeToInstant,
  type CalendarDate,
} from "./time-zone";
import { minutesOfDay, type WeeklyHours } from "./hours";

/**
 * The times a buyer may actually pick.
 *
 * Pure, and given everything it needs — the shop's hours and zone, the
 * service's length and notice period, the bookings already taken, and the
 * clock. Nothing here reads a database or the current time, so every rule
 * below is testable at the boundary where it bites: the last slot of the day,
 * the first one past the notice period, the hour that daylight saving deletes.
 *
 * A slot is a half-open interval. Nine-to-ten and ten-to-eleven do not clash;
 * treating the end as inclusive would lose one appointment in every pair.
 */

export type Slot = { startsAt: Date; endsAt: Date };

/** A booking already on the books, whatever length it was agreed at. */
export type Busy = { startsAt: Date; endsAt: Date };

export function overlaps(a: Busy, b: Busy): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export type SlotOptions = {
  hours: WeeklyHours;
  timeZone: string;
  /** How long the service takes. Also the spacing, unless `stepMinutes` says. */
  durationMinutes: number;
  /** Notice the seller wants, in hours. */
  leadHours: number;
  /** Bookings that already exist, in any length. */
  busy: Busy[];
  now: Date;
  /** Spacing between starts, when a shop wants them on the half hour. */
  stepMinutes?: number;
};

/**
 * Every free slot on one calendar date, in the shop's zone.
 *
 * Windows are walked in wall-clock minutes rather than by adding milliseconds
 * to an instant, which is what makes a daylight-saving day come out right: a
 * nine-to-five window is one hour shorter in real time on the day the clocks
 * go forward, and the slot that would have fallen in the deleted hour simply
 * does not exist.
 */
export function slotsOnDate(date: CalendarDate, opts: SlotOptions): Slot[] {
  const duration = Math.trunc(opts.durationMinutes);
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const step = Math.trunc(opts.stepMinutes ?? duration);
  if (!Number.isFinite(step) || step <= 0) return [];

  const weekday = new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  ).getUTCDay();
  const windows = opts.hours[weekday] ?? [];
  if (windows.length === 0) return [];

  // A slot must start this far ahead, so a buyer cannot book in ten minutes'
  // time on a service that needs a day's notice.
  const earliest = new Date(
    opts.now.getTime() + Math.max(0, opts.leadHours) * 3_600_000,
  );

  const slots: Slot[] = [];

  for (const window of windows) {
    const opensAt = minutesOfDay(window.from);
    const closesAt = minutesOfDay(window.to);
    if (opensAt === null || closesAt === null) continue;

    for (let at = opensAt; at + duration <= closesAt; at += step) {
      const startsAt = zonedTimeToInstant(
        date,
        { hour: Math.floor(at / 60), minute: at % 60 },
        opts.timeZone,
      );
      // Null means the clock skipped this wall time. There is no such moment
      // to sell, so it is left out rather than moved.
      if (!startsAt) continue;

      const endsAt = new Date(startsAt.getTime() + duration * 60_000);
      if (startsAt < earliest) continue;

      const candidate = { startsAt, endsAt };
      if (opts.busy.some((taken) => overlaps(candidate, taken))) continue;

      slots.push(candidate);
    }
  }

  // Windows are normalised in order, but a shop with two of them still needs
  // its afternoon slots after its morning ones once both are collected.
  return slots.toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export type DaySlots = { date: string; slots: Slot[] };

/**
 * The next `days` calendar days, each with its free slots.
 *
 * Days with nothing free are kept rather than dropped, so a calendar can show
 * them as closed instead of silently skipping to next week — a buyer needs to
 * see that Sunday exists and is shut.
 */
export function slotsForDays(
  from: CalendarDate,
  days: number,
  opts: SlotOptions,
): DaySlots[] {
  const span = Math.max(0, Math.min(90, Math.trunc(days)));
  return Array.from({ length: span }, (_, i) => {
    const date = addDays(from, i);
    return { date: toIsoDate(date), slots: slotsOnDate(date, opts) };
  });
}

/** Today's date in the shop's zone — the first day a calendar should show. */
export function todayIn(timeZone: string, now: Date): CalendarDate {
  const { year, month, day } = zonedParts(now, timeZone);
  return { year, month, day };
}

/**
 * Whether an instant is a slot the shop is genuinely offering.
 *
 * The check the server repeats at checkout. The browser was handed a list of
 * free slots, but a list is a snapshot: by the time the order arrives the slot
 * may have been taken, the seller may have changed their hours, or the value
 * may never have come from the list at all. Re-deriving the slots for that one
 * date and looking for an exact start is the only answer that cannot be
 * argued with.
 */
export function isOfferedSlot(startsAt: Date, opts: SlotOptions): boolean {
  if (Number.isNaN(startsAt.getTime())) return false;

  const { year, month, day } = zonedParts(startsAt, opts.timeZone);
  return slotsOnDate({ year, month, day }, opts).some(
    (slot) => slot.startsAt.getTime() === startsAt.getTime(),
  );
}
