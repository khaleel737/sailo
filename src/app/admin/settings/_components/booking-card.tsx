"use client";

import { useState } from "react";
import { Card, Field, Input, Select } from "@/components/ui";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import {
  clockTime,
  minutesOfDay,
  normalizeWeeklyHours,
  WEEKDAYS,
  type WeeklyHours,
} from "@/lib/booking/hours";
import type { Shop } from "@/db/schema";

/**
 * When the shop takes appointments.
 *
 * The whole card is a controlled editor over one hidden field, because the
 * shape is a seven-day array of windows and a form cannot express that in flat
 * inputs without inventing a naming scheme nobody can read on the server. The
 * hidden field carries JSON; `updateShop` validates it rather than trusting it.
 *
 * A day with no windows is closed, and closed is the default for Saturday and
 * Sunday — the common case, and the one a seller should not have to configure
 * to get right.
 */

/** A zone list short enough to scan, with the seller's own always present. */
const COMMON_ZONES = [
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

function zoneChoices(current: string): string[] {
  const all = COMMON_ZONES.includes(current)
    ? COMMON_ZONES
    : [current, ...COMMON_ZONES];
  return all;
}

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

export function BookingCard({ shop, hours }: { shop: Shop; hours: WeeklyHours }) {
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

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{a.settings.booking}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.settings.bookingBody}</p>
      </div>

      <Field label={a.settings.timeZone} hint={a.settings.timeZoneHint}>
        <Select name="timeZone" defaultValue={shop.timeZone}>
          {zoneChoices(shop.timeZone).map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-ink-700">
          {a.settings.openingHours}
        </legend>

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
                    aria-label={`${a.weekdays[weekday]} ${a.settings.opensAt}`}
                    value={row.from}
                    onChange={(e) => update(day, { from: e.target.value })}
                    className="w-32"
                  />
                  <span className="text-xs text-ink-500">—</span>
                  <Input
                    type="time"
                    aria-label={`${a.weekdays[weekday]} ${a.settings.closesAt}`}
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

      <input type="hidden" name="bookingHours" value={serialized} />

      <Field label={a.settings.slotSpacing} hint={a.settings.slotSpacingHint}>
        <Select
          name="bookingSlotMinutes"
          defaultValue={String(shop.bookingSlotMinutes ?? "")}
        >
          <option value="">{a.settings.slotFollowsDuration}</option>
          {[15, 20, 30, 45, 60].map((minutes) => (
            <option key={minutes} value={minutes}>
              {clockTime(minutes).replace(/^00:/, "")} min
            </option>
          ))}
        </Select>
      </Field>
    </Card>
  );
}
