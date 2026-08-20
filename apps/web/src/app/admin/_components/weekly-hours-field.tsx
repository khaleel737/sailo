"use client";

import { useState } from "react";
import { Input } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import {
  minutesOfDay,
  normalizeWeeklyHours,
  WEEKDAYS,
  type WeeklyHours,
} from "@sailo/commerce/booking";

/**
 * A week of opening hours, as a controlled editor over one hidden field.
 *
 * The shape is a seven-day array of windows and a form cannot express that in
 * flat inputs without inventing a naming scheme nobody can read on the server,
 * so the whole editor maintains one hidden field carrying JSON. The action
 * validates and normalises it rather than trusting it — `readBookingHours`.
 *
 * It lives here rather than inside the settings card because the shop is no
 * longer the only thing that has hours: spec 51 gives every person on the
 * roster their own, falling back to the shop's, and a second copy of this would
 * be a second place for "closes before it opens" to stop being said.
 */

type Row = { open: boolean; from: string; to: string };

/** One editable row per day — the flat shape the inputs actually need. */
function toRows(hours: WeeklyHours): Row[] {
  return hours.map((windows) => {
    const first = windows[0];
    return {
      open: windows.length > 0,
      from: first?.from ?? "09:00",
      to: first?.to ?? "17:00",
    };
  });
}

function toHours(rows: Row[]): WeeklyHours {
  return normalizeWeeklyHours(
    rows.map((row) => (row.open ? [{ from: row.from, to: row.to }] : [])),
  );
}

export function WeeklyHoursField({
  name,
  hours,
  legend,
  /**
   * Prefixed onto each row's `aria-label`, so a page carrying more than one of
   * these — a roster of stylists — does not read out "Monday opens at" three
   * times with nothing to tell them apart.
   */
  labelPrefix,
}: {
  name: string;
  hours: WeeklyHours;
  legend: string;
  labelPrefix?: string;
}) {
  const a = useAdminT();
  const [rows, setRows] = useState<Row[]>(() => toRows(hours));

  const update = (day: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row, i) => (i === day ? { ...row, ...patch } : row)),
    );

  /*
   * The value the server reads. Kept in sync with the rows on every render
   * rather than in an effect: it is derived state, and an effect would let it
   * be one keystroke stale exactly when the seller presses Save.
   */
  const serialized = JSON.stringify(toHours(rows));

  const label = (text: string) =>
    labelPrefix ? `${labelPrefix} — ${text}` : text;

  return (
    <>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-ink-700">{legend}</legend>

        {WEEKDAYS.map((weekday, day) => {
          const row = rows[day] ?? { open: false, from: "09:00", to: "17:00" };
          const opens = minutesOfDay(row.from);
          const closes = minutesOfDay(row.to);
          const backwards = opens !== null && closes !== null && closes <= opens;

          return (
            <div
              key={weekday}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 p-2"
            >
              <label className="flex min-w-28 cursor-pointer items-center gap-2 pointer-coarse:min-h-11">
                <input
                  type="checkbox"
                  checked={row.open}
                  onChange={(e) => update(day, { open: e.target.checked })}
                  className="size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
                />
                <span className="text-sm">{a.weekdays[weekday]}</span>
              </label>

              {row.open ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="time"
                    aria-label={label(`${a.weekdays[weekday]} ${a.settings.opensAt}`)}
                    value={row.from}
                    onChange={(e) => update(day, { from: e.target.value })}
                    className="w-32"
                  />
                  <span className="text-xs text-ink-500">—</span>
                  <Input
                    type="time"
                    aria-label={label(`${a.weekdays[weekday]} ${a.settings.closesAt}`)}
                    value={row.to}
                    onChange={(e) => update(day, { to: e.target.value })}
                    className="w-32"
                  />
                  {backwards ? (
                    // Said here rather than only on save: the seller is looking
                    // at the two fields that disagree.
                    <span className="text-xs text-red-600">
                      {a.settings.closesBeforeOpens}
                    </span>
                  ) : null}
                </div>
              ) : (
                <span className="text-xs text-ink-500">{a.settings.closed}</span>
              )}
            </div>
          );
        })}
      </fieldset>

      <input type="hidden" name={name} value={serialized} />
    </>
  );
}

/**
 * The zones a seller picks from — short enough to scan, with their own always
 * present even when it is not on the list.
 */
export const COMMON_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Istanbul",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Manila",
  "Asia/Tokyo",
  "Australia/Sydney",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];

export function zoneChoices(current: string): string[] {
  return COMMON_ZONES.includes(current) ? COMMON_ZONES : [current, ...COMMON_ZONES];
}
