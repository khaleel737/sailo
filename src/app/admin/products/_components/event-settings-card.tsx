"use client";

import { Card, Field, Input } from "@/components/ui";
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
