"use client";

import { Card, Field, Input, Select, Textarea } from "@sailo/design-system/web";
import { Toggle } from "./toggle";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { ProductWithRelations } from "./product.types";

/** How a service is booked, and how long it runs. */

export function ServiceSettingsCard({
  product,
  bookingEnabled,
  onBookingEnabledChange,
  staffResources = false,
}: {
  product?: ProductWithRelations;
  bookingEnabled: boolean;
  onBookingEnabledChange: (next: boolean) => void;
  /** Whether the plan includes staff and classes — spec 51. */
  staffResources?: boolean;
}) {
  const a = useAdminT();

  return (
          <Card className="space-y-4 p-5">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">
                {a.productForm.serviceTitle}
              </h2>
              <p className="mt-0.5 text-xs text-ink-500">
                {a.productForm.serviceBody}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={a.productForm.duration}
                htmlFor="durationMinutes"
                hint={a.common.optional}
              >
                <Input
                  id="durationMinutes"
                  name="durationMinutes"
                  inputMode="numeric"
                  defaultValue={product?.durationMinutes ?? ""}
                  placeholder="60"
                />
              </Field>
              <Field label={a.productForm.where} htmlFor="serviceMode">
                <Select
                  id="serviceMode"
                  name="serviceMode"
                  defaultValue={product?.serviceMode ?? "in_person"}
                >
                  <option value="in_person">{a.productForm.inPerson}</option>
                  <option value="online">{a.productForm.online}</option>
                </Select>
              </Field>
            </div>

            <Field
              label={a.productForm.serviceLocation}
              htmlFor="serviceLocation"
              hint={a.productForm.serviceLocationHint}
            >
              <Textarea
                id="serviceLocation"
                name="serviceLocation"
                rows={2}
                defaultValue={product?.serviceLocation ?? ""}
                placeholder={a.productForm.serviceLocationPlaceholder}
              />
            </Field>

            <Toggle
              name="bookingEnabled"
              label={a.productForm.bookingEnabled}
              description={a.productForm.bookingEnabledBody}
              checked={bookingEnabled}
              onChange={onBookingEnabledChange}
            />

            {/*
              Both only while there is a picker to govern. Notice and buffer
              are read by the calendar and by nothing else, so on a service
              booked over WhatsApp they would be two numbers that do nothing.
            */}
            {bookingEnabled ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={a.productForm.bookingLead}
                  htmlFor="bookingLeadHours"
                  help={a.productForm.bookingLeadHint}
                >
                  <Input
                    id="bookingLeadHours"
                    name="bookingLeadHours"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    defaultValue={product?.bookingLeadHours ?? 24}
                    placeholder="24"
                  />
                </Field>
                <Field
                  label={a.productForm.bookingBuffer}
                  htmlFor="bookingBufferMinutes"
                  hint={a.common.optional}
                  help={a.productForm.bookingBufferHint}
                >
                  <Input
                    id="bookingBufferMinutes"
                    name="bookingBufferMinutes"
                    type="number"
                    min={0}
                    max={1440}
                    inputMode="numeric"
                    defaultValue={product?.bookingBufferMinutes || ""}
                    placeholder="15"
                  />
                </Field>
              </div>
            ) : null}

            {/*
              Group bookings and buyer self-service — spec 51.

              The two cutoffs are **not** plan-gated: a buyer moving their own
              appointment prevents a loss rather than creating a sale, and
              gating it would price the smallest shops out of not being stood
              up. `bookingCapacity` is, because a class is what Pro buys.
            */}
            <div className="space-y-4 border-t border-black/5 pt-4">
              {staffResources ? (
                <Field
                  label={a.productForm.bookingCapacity}
                  htmlFor="bookingCapacity"
                  help={a.productForm.bookingCapacityHint}
                >
                  <Input
                    id="bookingCapacity"
                    name="bookingCapacity"
                    inputMode="numeric"
                    defaultValue={product?.bookingCapacity ?? ""}
                    placeholder="12"
                    className="sm:w-32"
                  />
                </Field>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={a.productForm.rescheduleCutoff}
                  htmlFor="rescheduleCutoffHours"
                  help={a.productForm.rescheduleCutoffHint}
                >
                  <Input
                    id="rescheduleCutoffHours"
                    name="rescheduleCutoffHours"
                    inputMode="numeric"
                    defaultValue={product?.rescheduleCutoffHours ?? ""}
                    placeholder="24"
                  />
                </Field>
                <Field
                  label={a.productForm.cancelCutoff}
                  htmlFor="cancelCutoffHours"
                  help={a.productForm.cancelCutoffHint}
                >
                  <Input
                    id="cancelCutoffHours"
                    name="cancelCutoffHours"
                    inputMode="numeric"
                    defaultValue={product?.cancelCutoffHours ?? ""}
                    placeholder="24"
                  />
                </Field>
              </div>
            </div>
          </Card>
  );
}
