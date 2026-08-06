"use client";

import { Field, Input, Textarea } from "@/components/ui";
import type { Dictionary } from "@/i18n";
import type { SetField, Values } from "./onboarding.types";

export function ShopDetailsStep({
  values,
  set,
  t,
}: {
  values: Values;
  set: SetField;
  t: Dictionary;
}) {
  return (
    <>
                  <Field label={t.onboarding.shopName} htmlFor="name">
                    <Input
                      id="name"
                      name="name"
                      required
                      autoFocus
                      value={values.name}
                      onChange={set("name")}
                      placeholder="Amina's Ceramics"
                    />
                  </Field>

                  <Field
                    label={t.onboarding.shortDescription}
                    htmlFor="description"
                    hint={t.common.optional}
                  >
                    <Textarea
                      id="description"
                      name="description"
                      rows={2}
                      maxLength={280}
                      value={values.description}
                      onChange={set("description")}
                      placeholder="Handmade stoneware, fired in small batches in Portland."
                    />
                  </Field>

                  <Field
                    label={t.onboarding.location}
                    htmlFor="location"
                    hint={t.common.optional}
                  >
                    <Input
                      id="location"
                      name="location"
                      value={values.location}
                      onChange={set("location")}
                      placeholder="Portland, Oregon"
                    />
                  </Field>
    </>
  );
}
