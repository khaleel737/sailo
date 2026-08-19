"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
} from "@sailo/design-system/web";
import { useAdminLocale, useAdminT } from "@/app/admin/_components/admin-i18n";
import { countryName } from "@sailo/core/countries";
import { interpolate } from "@sailo/i18n";
import { setTaxCountry, updateTaxOptions } from "@/lib/actions/tax";
import type { ActionState } from "@sailo/core/action-state";
import type { Shop, TaxCountryRule } from "@sailo/db/schema";

const IDLE: ActionState = { ok: false };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}

/**
 * Which countries this shop trades with, and the two switches that move them.
 *
 * The one thing this screen has to be clear about is what a switch does *not*
 * do. Turning a country off governs new checkouts only — a member in that
 * country keeps renewing, because otherwise a compliance toggle silently
 * cancels paying members, which spec 38 names as a thing that must not happen.
 */
export function CountriesCard({
  shop,
  rules,
  countries,
}: {
  shop: Shop;
  rules: TaxCountryRule[];
  /** Sorted on the server — see `RegistrationsCard` for why. */
  countries: { code: string; name: string }[];
}) {
  const a = useAdminT();
  const locale = useAdminLocale();
  const [state, action] = useActionState(updateTaxOptions, IDLE);

  const blocked = rules.filter((r) => !r.salesEnabled);

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{a.tax.countriesTitle}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.tax.countriesBody}</p>
      </div>

      <form action={action} className="space-y-4">
        <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            name="taxDisableImmediateObligation"
            defaultChecked={shop.taxDisableImmediateObligation}
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
          />
          <span>
            <span className="block text-sm font-medium">{a.tax.disableImmediate}</span>
            <span className="block text-xs text-ink-500">
              {a.tax.disableImmediateBody}
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            name="taxDisableOnThreshold"
            defaultChecked={shop.taxDisableOnThreshold}
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
          />
          <span>
            <span className="block text-sm font-medium">
              {a.tax.disableOnThreshold}
            </span>
            <span className="block text-xs text-ink-500">
              {a.tax.disableOnThresholdBody}
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            name="taxOssRegistered"
            defaultChecked={shop.taxOssRegistered}
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
          />
          <span>
            <span className="block text-sm font-medium">{a.tax.ossRegistered}</span>
            <span className="block text-xs text-ink-500">
              {a.tax.ossRegisteredBody}
            </span>
          </span>
        </label>

        {/*
          Stripe's own category code, and hidden on the flat rate — where it
          feeds nothing at all. The same treatment `taxIdCollection` gets on the
          details tab, and for the same reason: a control that does nothing is
          worse than one that is absent.
        */}
        {shop.taxMode === "stripe" ? (
          <Field
            label={a.tax.taxCategory}
            htmlFor="tax-category"
            hint={a.tax.taxCategoryHint}
          >
            <Input
              id="tax-category"
              name="taxCategory"
              defaultValue={shop.taxCategory ?? ""}
              placeholder="txcd_10000000"
              maxLength={32}
            />
          </Field>
        ) : (
          /* Submitted unchanged while hidden, so a seller who tried Stripe Tax
             and switched back does not silently lose the category they set. */
          <input type="hidden" name="taxCategory" value={shop.taxCategory ?? ""} />
        )}

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <Submit label={a.common.save} />
      </form>

      <div className="border-t border-ink-200 pt-4">
        <p className="text-xs font-medium text-ink-700">{a.tax.blockedTitle}</p>
        {blocked.length === 0 ? (
          <p className="mt-1 text-xs text-ink-500">{a.tax.noBlocked}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {blocked.map((rule) => (
              <li
                key={rule.country}
                className="flex items-start justify-between gap-3"
              >
                <span className="text-sm">
                  <span className="font-medium text-ink-900">
                    {countryName(rule.country, locale)}
                  </span>
                  {rule.autoDisabledReason ? (
                    <span className="mt-0.5 block text-xs text-ink-500">
                      {interpolate(a.tax.autoDisabled, {
                        reason: rule.autoDisabledReason,
                      })}
                    </span>
                  ) : null}
                </span>
                <form action={setTaxCountry}>
                  <input type="hidden" name="country" value={rule.country} />
                  <input type="hidden" name="enabled" value="on" />
                  <Button type="submit" size="sm" variant="ghost">
                    {a.tax.enable}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form action={setTaxCountry} className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <Field label={a.tax.addCountry} htmlFor="block-country">
              <Select id="block-country" name="country" required defaultValue="">
                <option value="" disabled />
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit" size="sm" variant="secondary">
            {a.tax.disable}
          </Button>
        </form>
      </div>
    </Card>
  );
}
