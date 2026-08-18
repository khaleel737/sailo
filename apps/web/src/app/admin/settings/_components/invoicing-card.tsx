"use client";

import { Card, Field, Input, Select, Textarea } from "@sailo/design-system/web";
import { COUNTRY_CODES, countryName } from "@sailo/core/countries";
import { useAdminLocale, useAdminT } from "@/app/admin/_components/admin-i18n";
import type { Shop } from "@sailo/db/schema";

/**
 * The invoice: its numbering, its footer, and who it says issued it.
 *
 * Every column behind this card already existed and was already printed — the
 * PDF renderer and the public invoice page have read `invoicePrefix` and
 * `invoiceNotes` since invoices did — and none of them had anywhere to be set.
 * A seller was on `INV-0001` for ever, with no footer and no way to add one, and
 * the only place the values appeared at all was /hq.
 *
 * **The counter is shown, not editable.** It is the one number here a seller
 * would want to change and the one they must not: an invoice sequence has to be
 * gapless and unrepeated, and a field that could be set backwards would issue a
 * second invoice at a number already used. `createInvoiceForOrder` advances it
 * atomically and nothing else writes it, so the read-only line is the honest
 * shape — it answers "what will the next one be" without offering a hand on it.
 */
export function InvoicingCard({ shop }: { shop: Shop }) {
  const a = useAdminT();
  const locale = useAdminLocale();

  const nextNumber = `${shop.invoicePrefix}-${String(shop.invoiceNextNumber).padStart(4, "0")}`;

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.settings.invoicing}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.settings.invoicingBody}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={a.settings.invoicePrefix}
          htmlFor="invoicePrefix"
          hint={a.settings.invoicePrefixHint}
        >
          <Input
            id="invoicePrefix"
            name="invoicePrefix"
            defaultValue={shop.invoicePrefix}
            maxLength={12}
            autoComplete="off"
            spellCheck={false}
            placeholder="INV"
          />
        </Field>

        <Field label={a.settings.invoiceNext}>
          {/*
            A line of text, not a disabled input. A greyed-out field invites a
            seller to hunt for the thing that would un-grey it; a sentence tells
            them what the number is and that it is not theirs to set.
          */}
          <p className="pt-2 font-mono text-sm text-ink-900">{nextNumber}</p>
          <p className="mt-1 text-xs text-ink-500">{a.settings.invoiceNextHint}</p>
        </Field>
      </div>

      <Field
        label={a.settings.invoiceNotes}
        htmlFor="invoiceNotes"
        hint={a.settings.invoiceNotesHint}
      >
        <Textarea
          id="invoiceNotes"
          name="invoiceNotes"
          rows={3}
          maxLength={500}
          defaultValue={shop.invoiceNotes ?? ""}
        />
      </Field>

      <div className="space-y-4 border-t border-ink-200 pt-4">
        <div>
          <h3 className="text-sm font-medium text-ink-900">
            {a.settings.invoiceIssuer}
          </h3>
          {/*
            Says plainly that leaving it blank is allowed and what happens then.
            Most sellers here are sole traders under a registration threshold
            and have no registered entity to name; a block of empty fields with
            no explanation reads as eight things they have failed to do.
          */}
          <p className="mt-0.5 text-xs text-ink-500">
            {a.settings.invoiceIssuerBody}
          </p>
        </div>

        <Field
          label={a.settings.invoiceLegalName}
          htmlFor="invoiceLegalName"
          hint={a.settings.invoiceLegalNameHint}
        >
          <Input
            id="invoiceLegalName"
            name="invoiceLegalName"
            defaultValue={shop.invoiceLegalName ?? ""}
            maxLength={120}
            placeholder={shop.name}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.settings.invoiceAddressLine1} htmlFor="invoiceAddressLine1">
            <Input
              id="invoiceAddressLine1"
              name="invoiceAddressLine1"
              defaultValue={shop.invoiceAddressLine1 ?? ""}
              maxLength={120}
              autoComplete="address-line1"
            />
          </Field>

          <Field
            label={a.settings.invoiceAddressLine2}
            htmlFor="invoiceAddressLine2"
            hint={a.common.optional}
          >
            <Input
              id="invoiceAddressLine2"
              name="invoiceAddressLine2"
              defaultValue={shop.invoiceAddressLine2 ?? ""}
              maxLength={120}
              autoComplete="address-line2"
            />
          </Field>

          <Field label={a.settings.invoiceCity} htmlFor="invoiceCity">
            <Input
              id="invoiceCity"
              name="invoiceCity"
              defaultValue={shop.invoiceCity ?? ""}
              maxLength={80}
              autoComplete="address-level2"
            />
          </Field>

          <Field
            label={a.settings.invoiceRegion}
            htmlFor="invoiceRegion"
            hint={a.common.optional}
          >
            <Input
              id="invoiceRegion"
              name="invoiceRegion"
              defaultValue={shop.invoiceRegion ?? ""}
              maxLength={80}
              autoComplete="address-level1"
            />
          </Field>

          <Field label={a.settings.invoicePostalCode} htmlFor="invoicePostalCode">
            <Input
              id="invoicePostalCode"
              name="invoicePostalCode"
              defaultValue={shop.invoicePostalCode ?? ""}
              maxLength={20}
              autoComplete="postal-code"
            />
          </Field>

          <Field label={a.settings.invoiceCountry} htmlFor="invoiceCountry">
            <Select
              id="invoiceCountry"
              name="invoiceCountry"
              defaultValue={shop.invoiceCountry ?? ""}
            >
              <option value="">{a.common.optional}</option>
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>
                  {countryName(code, locale)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label={a.settings.invoiceRegistrationNumber}
          htmlFor="invoiceRegistrationNumber"
          hint={a.settings.invoiceRegistrationNumberHint}
        >
          <Input
            id="invoiceRegistrationNumber"
            name="invoiceRegistrationNumber"
            defaultValue={shop.invoiceRegistrationNumber ?? ""}
            maxLength={64}
            autoComplete="off"
          />
        </Field>
      </div>
    </Card>
  );
}
