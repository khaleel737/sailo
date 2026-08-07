"use client";

import { Field, Input, Select } from "@/components/ui";
import { CURRENCY_CODES, currencyLabel } from "@/lib/currency";
import type { Dictionary } from "@/i18n";
import type { SetField, Values } from "./onboarding.types";

export function SellingStep({
  values,
  set,
  t,
  locale,
}: {
  values: Values;
  set: SetField;
  t: Dictionary;
  locale: string;
}) {
  return (
    <>
                  <Field label={t.onboarding.currency} htmlFor="currency">
                    <Select
                      id="currency"
                      name="currency"
                      value={values.currency}
                      onChange={set("currency")}
                    >
                      {CURRENCY_CODES.map((c) => (
                        <option key={c} value={c}>
                          {currencyLabel(c, locale)}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field
                    label={t.onboarding.whatsapp}
                    htmlFor="whatsapp"
                    hint={t.common.optional}
                    help={t.onboarding.whatsappHint}
                  >
                    <Input
                      id="whatsapp"
                      name="whatsapp"
                      inputMode="tel"
                      autoFocus
                      value={values.whatsapp}
                      onChange={set("whatsapp")}
                      placeholder="234801234567"
                    />
                  </Field>
    </>
  );
}
