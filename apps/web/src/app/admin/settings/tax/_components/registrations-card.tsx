"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Alert,
  Button,
  Card,
  EmptyRow,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
  Tr,
} from "@sailo/design-system/web";
import { useAdminLocale, useAdminT } from "@/app/admin/_components/admin-i18n";
import { countryName } from "@sailo/core/countries";
import {
  removeTaxJurisdiction,
  saveTaxJurisdiction,
} from "@/lib/actions/tax";
import type { ActionState } from "@sailo/core/action-state";
import type { TaxJurisdiction } from "@sailo/db/schema";

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
 * The seller's own record of where they are registered.
 *
 * The sentence under the heading changes with the tax mode, and it has to: a
 * seller on Stripe Tax who adds a registration here and sees no rate change
 * will otherwise file a bug, because on that mode Stripe's own registration
 * list is what decides what a buyer pays. On the flat rate a row's own rate
 * genuinely does override the shop's, for buyers in that country.
 */
export function RegistrationsCard({
  registrations,
  taxMode,
  currency,
  countries,
}: {
  registrations: TaxJurisdiction[];
  taxMode: string;
  /** Only for the rate column's placeholder — no money is rendered here. */
  currency: string;
  /**
   * Sorted on the server and passed in, never sorted here.
   *
   * `Intl.Collator` does not put every accented name in the same place in Node
   * as it does in the browser, so a list this component sorted for itself
   * rendered in one order server-side and another after hydration — which
   * React reports as a mismatch and repairs by discarding the subtree.
   */
  countries: { code: string; name: string }[];
}) {
  const a = useAdminT();
  const locale = useAdminLocale();
  const [state, action] = useActionState(saveTaxJurisdiction, IDLE);

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.tax.registrationsTitle}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.tax.registrationsBody}</p>
      </div>

      <Alert tone="info">
        {taxMode === "stripe"
          ? a.tax.registrationsStripe
          : a.tax.registrationsManual}
      </Alert>

      <Table
        minWidth="42rem"
        head={
          <>
            <Th>{a.tax.country}</Th>
            <Th>{a.tax.region}</Th>
            <Th>{a.tax.registrationNumber}</Th>
            <Th>{a.tax.registeredOn}</Th>
            <Th>{a.tax.expiresOn}</Th>
            <Th align="end">{a.tax.localRate}</Th>
            <Th align="end" />
          </>
        }
      >
        {registrations.length === 0 ? (
          <EmptyRow colSpan={7}>{a.tax.noRegistrations}</EmptyRow>
        ) : (
          registrations.map((row) => (
            <Tr key={row.id}>
              <Td>
                <span className="font-medium text-ink-900">
                  {countryName(row.country, locale)}
                </span>
              </Td>
              <Td label={a.tax.region}>{row.region ?? "—"}</Td>
              <Td label={a.tax.registrationNumber}>
                <span className="font-mono text-xs">
                  {row.registrationNumber ?? "—"}
                </span>
              </Td>
              <Td label={a.tax.registeredOn}>{row.registeredOn ?? "—"}</Td>
              <Td label={a.tax.expiresOn}>{row.expiresOn ?? "—"}</Td>
              <Td align="end" label={a.tax.localRate}>
                {/*
                  Null and zero are different answers and both are shown as
                  themselves: blank means "use the shop rate", 0% means "zero
                  rated here". Rendering null as 0 would be the blank-vs-zero
                  bug on a screen instead of in a column.
                */}
                {row.rateBp === null
                  ? a.tax.usesShopRate
                  : `${(row.rateBp / 100).toFixed(2)}%`}
              </Td>
              <Td align="end">
                <form action={removeTaxJurisdiction}>
                  <input type="hidden" name="id" value={row.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    {a.tax.remove}
                  </Button>
                </form>
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <form action={action} className="space-y-4 border-t border-ink-200 pt-4">
        <p className="text-xs font-medium text-ink-700">{a.tax.addRegistration}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.tax.country} htmlFor="tax-country">
            <Select id="tax-country" name="country" required defaultValue="">
              <option value="" disabled />
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={a.tax.region}
            htmlFor="tax-region"
            hint={a.tax.regionHint}
          >
            <Input id="tax-region" name="region" maxLength={8} placeholder="CA" />
          </Field>

          <Field label={a.tax.registrationNumber} htmlFor="tax-number">
            <Input id="tax-number" name="registrationNumber" maxLength={64} />
          </Field>

          <Field
            label={a.tax.localRate}
            htmlFor="tax-rate-bp"
            hint={a.tax.localRateHint}
          >
            <Input
              id="tax-rate-bp"
              name="rateBp"
              type="number"
              min={0}
              max={100}
              step="0.01"
              inputMode="decimal"
              placeholder={currency === "USD" ? "7.25" : "20"}
            />
          </Field>

          <Field label={a.tax.registeredOn} htmlFor="tax-registered-on">
            <Input id="tax-registered-on" name="registeredOn" type="date" />
          </Field>

          <Field label={a.tax.expiresOn} htmlFor="tax-expires-on">
            <Input id="tax-expires-on" name="expiresOn" type="date" />
          </Field>
        </div>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <Submit label={a.tax.addRegistration} />
      </form>
    </Card>
  );
}
