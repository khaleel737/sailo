"use client";

import Link from "next/link";
import { Card, Field, Input, Select, Switch } from "@/components/ui";
import { CURRENCY_CODES, currencyLabel } from "@/lib/currency";
import { LOCALES } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { useAdminLocale, useAdminT } from "@/app/admin/_components/admin-i18n";
import type { Shop } from "@/db/schema";

export function OrdersContactCard({ shop, t }: { shop: Shop; t: Dictionary }) {
  const a = useAdminT();
  const locale = useAdminLocale();

  return (
          <Card className="space-y-4 p-5">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">{a.settings.ordersContact}</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                {a.settings.waysToOrderLiveIn}{" "}
                <Link
                  href="/admin/payments"
                  className="font-medium text-ink-700 underline underline-offset-2"
                >
                {a.payments.title}
                </Link>
                .
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={a.settings.currency} htmlFor="currency">
                <Select id="currency" name="currency" defaultValue={shop.currency}>
                  {CURRENCY_CODES.map((c) => (
                    <option key={c} value={c}>
                      {currencyLabel(c, locale)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label={t.settings.storefrontLanguage}
                htmlFor="locale"
                hint={t.settings.storefrontLanguageHint}
              >
                <Select id="locale" name="locale" defaultValue={shop.locale ?? ""}>
                  <option value="">
                    {a.settings.matchBrowser}
                  </option>
                  {LOCALES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.native} — {l.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label={a.settings.contactEmail}
                htmlFor="contactEmail"
                hint={a.common.optional}
              >
                <Input
                  id="contactEmail"
                  name="contactEmail"
                  type="email"
                  defaultValue={shop.contactEmail ?? ""}
                />
              </Field>
            </div>

            <Field
              label={a.settings.location}
              htmlFor="location"
              hint={a.common.optional}
            >
              <Input
                id="location"
                name="location"
                defaultValue={shop.location ?? ""}
                placeholder={a.settings.locationPlaceholder}
              />
            </Field>

            <div className="border-t border-ink-200 pt-4">
              <Switch
                name="collectAddress"
                defaultChecked={shop.collectAddress}
                label={a.settings.collectAddress}
                description={a.settings.collectAddressBody}
              />
            </div>
          </Card>
  );
}
