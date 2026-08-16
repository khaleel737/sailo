"use client";

import { Card, Field, Input, Select } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { Shop } from "@sailo/db/schema";

export function TaxCard({ shop }: { shop: Shop }) {
  const a = useAdminT();

  return (
          <Card className="space-y-4 p-5">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">{a.settings.tax}</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                {a.settings.taxBody}
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
              <input
                type="checkbox"
                name="taxEnabled"
                defaultChecked={shop.taxEnabled}
                className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
              />
              <span>
                <span className="block text-sm font-medium">{a.settings.chargeTax}</span>
                <span className="block text-xs text-ink-500">
                  {a.settings.chargeTaxBody}
                </span>
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={a.settings.taxName}
                htmlFor="taxName"
                hint={a.settings.taxNameHint}
              >
                <Input
                  id="taxName"
                  name="taxName"
                  defaultValue={shop.taxName}
                  placeholder="VAT"
                  maxLength={40}
                />
              </Field>

              <Field
                label={a.settings.taxRate}
                htmlFor="taxRate"
                hint={a.settings.taxRateHint}
              >
                <Input
                  id="taxRate"
                  name="taxRate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  inputMode="decimal"
                  defaultValue={
                    shop.taxRateBp ? String(shop.taxRateBp / 100) : ""
                  }
                  placeholder="20"
                />
              </Field>
            </div>

            <Field label={a.settings.taxShown} htmlFor="taxInclusive">
              <Select
                id="taxInclusive"
                name="taxInclusive"
                defaultValue={shop.taxInclusive ? "inclusive" : "exclusive"}
              >
                <option value="exclusive">
                  {a.settings.taxExclusive}
                </option>
                <option value="inclusive">
                  {a.settings.taxInclusive}
                </option>
              </Select>
            </Field>

            <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
              <input
                type="checkbox"
                name="taxOnDelivery"
                defaultChecked={shop.taxOnDelivery}
                className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
              />
              <span>
                <span className="block text-sm font-medium">
                  {a.settings.taxOnDelivery}
                </span>
                <span className="block text-xs text-ink-500">
                  {a.settings.taxOnDeliveryBody}
                </span>
              </span>
            </label>

            <Field
              label={a.settings.taxId}
              htmlFor="taxId"
              hint={a.settings.taxIdHint}
            >
              <Input
                id="taxId"
                name="taxId"
                defaultValue={shop.taxId ?? ""}
                placeholder={a.settings.taxIdPlaceholder}
              />
            </Field>
          </Card>
  );
}
