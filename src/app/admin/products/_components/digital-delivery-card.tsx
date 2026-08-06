"use client";

import { Card, Field, Input } from "@/components/ui";
import { Toggle } from "./toggle";
import { FileUploader } from "./file-uploader";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { ProductWithRelations } from "./product.types";

/** What a digital product delivers, and when the buyer gets it. */

export function DigitalDeliveryCard({
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
                {a.productForm.filesTitle}
              </h2>
              <p className="mt-0.5 text-xs text-ink-500">
                {a.productForm.filesBody}
              </p>
            </div>

            <FileUploader
              initial={
                product?.files.map((f) => ({
                  name: f.name,
                  url: f.url,
                  sizeBytes: f.sizeBytes,
                  contentType: f.contentType,
                })) ?? []
              }
            />

            <Toggle
              name="releaseOnPayment"
  label={a.productForm.releaseOnPayment}
  description={a.productForm.releaseOnPaymentBody}
              checked={releaseOnPayment}
              onChange={onReleaseOnPaymentChange}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={a.productForm.downloadLimit}
                htmlFor="downloadLimit"
                hint={a.productForm.downloadLimitHint}
              >
                <Input
                  id="downloadLimit"
                  name="downloadLimit"
                  inputMode="numeric"
                  defaultValue={product?.downloadLimit ?? ""}
                  placeholder="5"
                />
              </Field>
              <Field
                label={a.productForm.downloadExpiry}
                htmlFor="downloadExpiryDays"
                hint={a.productForm.downloadExpiryHint}
              >
                <Input
                  id="downloadExpiryDays"
                  name="downloadExpiryDays"
                  inputMode="numeric"
                  defaultValue={product?.downloadExpiryDays ?? ""}
                  placeholder="30"
                />
              </Field>
            </div>
          </Card>
  );
}
