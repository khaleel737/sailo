"use client";

import { Card, Field, Select } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import {
  WeeklyHoursField,
  zoneChoices,
} from "@/app/admin/_components/weekly-hours-field";
import { clockTime } from "@sailo/commerce/booking";
import { type WeeklyHours } from "@sailo/commerce/booking";
import type { Shop } from "@sailo/db/schema";

/**
 * When the shop takes appointments.
 *
 * The week itself is `WeeklyHoursField`, which was the middle of this card
 * until spec 51 gave every person on the roster hours of their own. A day with
 * no windows is closed, and closed is the default for Saturday and Sunday —
 * the common case, and the one a seller should not have to configure to get
 * right.
 */
export function BookingCard({ shop, hours }: { shop: Shop; hours: WeeklyHours }) {
  const a = useAdminT();

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

      <WeeklyHoursField
        name="bookingHours"
        hours={hours}
        legend={a.settings.openingHours}
      />

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
