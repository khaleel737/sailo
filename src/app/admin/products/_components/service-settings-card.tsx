"use client";

import { Card, Field, Input, Select, Textarea } from "@/components/ui";
import { Toggle } from "./toggle";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { ProductWithRelations } from "./product.types";

/** How a service is booked, and how long it runs. */

export function ServiceSettingsCard({
  product,
  bookingEnabled,
  onBookingEnabledChange,
}: {
  product?: ProductWithRelations;
  bookingEnabled: boolean;
  onBookingEnabledChange: (next: boolean) => void;
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

            {bookingEnabled ? (
              <Field
                label={a.productForm.bookingLead}
                htmlFor="bookingLeadHours"
                hint={a.productForm.bookingLeadHint}
              >
                <Input
                  id="bookingLeadHours"
                  name="bookingLeadHours"
                  inputMode="numeric"
                  defaultValue={product?.bookingLeadHours ?? 24}
                  placeholder="24"
                  className="sm:w-40"
                />
              </Field>
            ) : null}
          </Card>
  );
}
