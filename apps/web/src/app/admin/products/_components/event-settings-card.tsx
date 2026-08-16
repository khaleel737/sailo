"use client";

import { useState } from "react";
import { Card, Field, Input, Select } from "@sailo/design-system/web";
import { Toggle } from "./toggle";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { ProductWithRelations } from "./product.types";

/** When the event happens, where to turn up, and when tickets unlock. */

/** A Date as `datetime-local` wants it: local wall clock, minute precision. */
function toLocalInput(date: Date | null | undefined): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function EventSettingsCard({
  product,
  releaseOnPayment,
  onReleaseOnPaymentChange,
}: {
  product?: ProductWithRelations;
  releaseOnPayment: boolean;
  onReleaseOnPaymentChange: (next: boolean) => void;
}) {
  const a = useAdminT();
  /*
   * Which fields are even relevant is decided here rather than by a seller
   * reading labels: an online event has a join link and no venue, a room has
   * a venue and no link. Showing both invites a seller to fill in both, and
   * the product then has an address the buyer's email will never print.
   */
  const [mode, setMode] = useState(product?.serviceMode ?? "in_person");
  const online = mode === "online";

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.productForm.eventTitle}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.productForm.eventBody}</p>
      </div>

      <Field
        label={a.productForm.eventStartsAt}
        htmlFor="eventStartsAt"
        hint={a.productForm.eventStartsAtHint}
      >
        <Input
          id="eventStartsAt"
          name="eventStartsAt"
          type="datetime-local"
          required
          defaultValue={toLocalInput(product?.eventStartsAt)}
          className="sm:w-64"
        />
      </Field>

      <Field label={a.productForm.eventWhere} htmlFor="serviceMode">
        <Select
          id="serviceMode"
          name="serviceMode"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="sm:w-64"
        >
          <option value="in_person">{a.productForm.eventInPerson}</option>
          <option value="online">{a.productForm.eventOnline}</option>
        </Select>
      </Field>

      {online ? (
        <Field
          label={a.productForm.eventJoinUrl}
          htmlFor="eventJoinUrl"
          hint={a.productForm.eventJoinUrlHint}
        >
          <Input
            id="eventJoinUrl"
            name="eventJoinUrl"
            type="url"
            inputMode="url"
            maxLength={2000}
            defaultValue={product?.eventJoinUrl ?? ""}
            placeholder="https://zoom.us/j/…"
          />
        </Field>
      ) : (
        <Field
          label={a.productForm.eventVenue}
          htmlFor="serviceLocation"
          hint={a.productForm.serviceLocationHint}
        >
          <Input
            id="serviceLocation"
            name="serviceLocation"
            maxLength={500}
            defaultValue={product?.serviceLocation ?? ""}
            placeholder={a.productForm.eventVenuePlaceholder}
          />
        </Field>
      )}

      <Toggle
        name="releaseOnPayment"
        label={a.productForm.eventReleaseOnPayment}
        description={a.productForm.eventReleaseOnPaymentBody}
        checked={releaseOnPayment}
        onChange={onReleaseOnPaymentChange}
      />

      <p className="text-xs text-ink-500">{a.productForm.eventCapacityHint}</p>
    </Card>
  );
}
