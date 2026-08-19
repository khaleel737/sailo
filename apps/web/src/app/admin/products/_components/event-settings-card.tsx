"use client";

import { useState } from "react";
import { Card, Field, Input, Select, Textarea } from "@sailo/design-system/web";
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
  timeZone,
}: {
  product?: ProductWithRelations;
  releaseOnPayment: boolean;
  onReleaseOnPaymentChange: (next: boolean) => void;
  /** The shop's own zone, named so "19:00" means a particular 19:00. */
  timeZone: string;
}) {
  const a = useAdminT();
  const [collectAttendees, setCollectAttendees] = useState(
    () => product?.collectAttendeeDetails ?? false,
  );
  const [allowSelfCancel, setAllowSelfCancel] = useState(
    () => product?.eventAllowSelfCancel ?? false,
  );
  /*
   * Which fields are even relevant is decided here rather than by a seller
   * reading labels: an online event has a join link and no venue, a room has
   * a venue and no link. Showing both invites a seller to fill in both, and
   * the product then has an address the buyer's email will never print.
   */
  const [mode, setMode] = useState(product?.serviceMode ?? "in_person");
  const online = mode === "online";

  /*
   * Held in state only so the end can refuse to offer a moment before the
   * start. The server refuses it too — this is the version the seller meets
   * while they are still looking at the field, not the one that costs them a
   * round trip.
   */
  const [startsAt, setStartsAt] = useState(() => toLocalInput(product?.eventStartsAt));

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.productForm.eventTitle}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.productForm.eventBody}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={a.productForm.eventStartsAt}
          htmlFor="eventStartsAt"
          /* The shop's zone, named rather than assumed. "19:00" is not a
             moment until somebody says whose seven in the evening it is. */
          hint={timeZone}
          help={a.productForm.eventStartsAtHint}
        >
          <Input
            id="eventStartsAt"
            name="eventStartsAt"
            type="datetime-local"
            required
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </Field>

        {/*
          Optional, and it gates nothing — sales still close when the doors
          open. What it buys is a buyer's page that can say "19:00 – 22:00",
          which is the difference between an event somebody can plan an evening
          around and one they cannot.

          `min` is the start rather than a validation message, so the picker
          simply does not offer a moment before it.
        */}
        <Field
          label={a.productForm.eventEndsAt}
          htmlFor="eventEndsAt"
          hint={a.common.optional}
          help={a.productForm.eventEndsAtHint}
        >
          <Input
            id="eventEndsAt"
            name="eventEndsAt"
            type="datetime-local"
            min={startsAt || undefined}
            defaultValue={toLocalInput(product?.eventEndsAt)}
          />
        </Field>
      </div>

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

      {/*
        Venue, zone and policy — spec 50. None of it is plan-gated: a buyer's
        calendar entry being in the wrong timezone is correctness rather than
        upsell, and a refund policy nobody was shown is a dispute lost.
      */}
      <div className="space-y-4 border-t border-black/5 pt-4">
        <h3 className="text-[13px] font-medium text-ink-800">
          {a.productForm.eventVenueTitle}
        </h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.productForm.eventVenueName} htmlFor="eventVenueName">
            <Input
              id="eventVenueName"
              name="eventVenueName"
              maxLength={200}
              defaultValue={product?.eventVenueName ?? ""}
            />
          </Field>
          <Field
            label={a.productForm.eventTimeZone}
            htmlFor="eventTimeZone"
            help={a.productForm.eventTimeZoneHint}
          >
            <Input
              id="eventTimeZone"
              name="eventTimeZone"
              maxLength={64}
              defaultValue={product?.eventTimeZone ?? ""}
              placeholder="Europe/London"
            />
          </Field>
        </div>

        <Field label={a.productForm.eventAddress} htmlFor="eventAddress">
          <Textarea
            id="eventAddress"
            name="eventAddress"
            rows={2}
            maxLength={500}
            defaultValue={product?.eventAddress ?? ""}
          />
        </Field>

        <Toggle
          name="collectAttendeeDetails"
          label={a.productForm.collectAttendeeDetails}
          description={a.productForm.collectAttendeeDetailsHint}
          checked={collectAttendees}
          onChange={setCollectAttendees}
        />
      </div>

      <div className="space-y-4 border-t border-black/5 pt-4">
        <Field
          label={a.productForm.eventRefundPolicy}
          htmlFor="eventRefundPolicy"
          help={a.productForm.eventRefundPolicyHint}
        >
          <Textarea
            id="eventRefundPolicy"
            name="eventRefundPolicy"
            rows={3}
            maxLength={2000}
            defaultValue={product?.eventRefundPolicy ?? ""}
          />
        </Field>

        <Field
          label={a.productForm.eventRefundCutoff}
          htmlFor="eventRefundCutoffHours"
        >
          <Input
            id="eventRefundCutoffHours"
            name="eventRefundCutoffHours"
            inputMode="numeric"
            defaultValue={product?.eventRefundCutoffHours ?? ""}
            placeholder="48"
            className="sm:w-32"
          />
        </Field>

        <Toggle
          name="eventAllowSelfCancel"
          label={a.productForm.eventAllowSelfCancel}
          description={a.productForm.eventAllowSelfCancelHint}
          checked={allowSelfCancel}
          onChange={setAllowSelfCancel}
        />
      </div>
    </Card>
  );
}
