"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";
import { saveDeliveryMethod } from "@/lib/actions/delivery";
import { centsToAmount } from "@sailo/core/currency";
import { priceIn } from "@sailo/core/regional";
import {
  DELIVERY_METHOD_DEFS,
  DELIVERY_METHOD_LIST,
  type DeliveryMethodType,
} from "@sailo/commerce/delivery";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
} from "@sailo/design-system/web";
import type { DeliveryConfig, DeliveryMethod } from "@sailo/db/schema";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { CountryPicker } from "./country-picker";

/**
 * Rows the form draws. Fewer than the twenty `MAX_BANDS` the server accepts,
 * because a form that renders twenty empty pairs reads as a spreadsheet — and a
 * seller who genuinely needs more than eight bands wants a carrier account
 * rather than a longer table.
 */
const MAX_BAND_ROWS = 8;

function Submit({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : isEdit ? null : (
        <Plus className="size-4" />
      )}
      {isEdit ? "Save option" : "Add option"}
    </Button>
  );
}

export function DeliveryRateForm({
  method,
  currency,
  regionalCurrencies = [],
  weightBands = false,
}: {
  method?: DeliveryMethod;
  currency: string;
  /** The other currencies the shop quotes — spec 53. Empty renders no extra fields. */
  regionalCurrencies?: string[];
  /** Whether the plan prices postage by weight — spec 51. */
  weightBands?: boolean;
}) {
  const a = useAdminT();
  const [state, action] = useActionState(saveDeliveryMethod, { ok: false });
  const [type, setType] = useState<DeliveryMethodType>(
    (method?.type as DeliveryMethodType) ?? "shipping",
  );
  const formRef = useRef<HTMLFormElement>(null);
  const config = (method?.config ?? {}) as DeliveryConfig;

  /*
   * How this rate is priced — spec 51.
   *
   * The rows are held in state rather than rendered from the saved value alone,
   * because "add a band" has to work before anything is saved. Four blank rows
   * beyond whatever exists is enough for the tables sellers actually write —
   * light, medium, heavy, and one spare — without a button that grows the form
   * indefinitely for a feature whose whole point is that it is short.
   */
  const [byWeight, setByWeight] = useState(method?.rateMode === "by_weight");
  const savedBands = method?.weightBands ?? [];
  const bandRows = Array.from(
    { length: Math.min(MAX_BAND_ROWS, savedBands.length + 3) },
    (_, i) => savedBands[i] ?? null,
  );

  useEffect(() => {
    if (state.ok && !method) formRef.current?.reset();
  }, [state, method]);

  const def = DELIVERY_METHOD_DEFS[type];

  return (
    <Card className="p-5">
      <form ref={formRef} action={action} className="space-y-4">
        {method ? <input type="hidden" name="id" value={method.id} /> : null}

        {state.error ? <Alert>{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.delivery.kind} htmlFor={`${method?.id ?? "new"}-type`}>
            <Select
              id={`${method?.id ?? "new"}-type`}
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as DeliveryMethodType)}
            >
              {DELIVERY_METHOD_LIST.map((d) => (
                <option key={d.type} value={d.type}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={a.delivery.nameBuyersSee}
            htmlFor={`${method?.id ?? "new"}-name`}
          >
            <Input
              id={`${method?.id ?? "new"}-name`}
              name="name"
              required
              maxLength={60}
              defaultValue={method?.name ?? ""}
              placeholder={
                type === "shipping" ? "Standard delivery" : "Studio pickup"
              }
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Fee (${currency})`} htmlFor={`${method?.id ?? "new"}-fee`}>
            <Input
              id={`${method?.id ?? "new"}-fee`}
              name="fee"
              inputMode="decimal"
              defaultValue={centsToAmount(method?.feeCents ?? 0, currency)}
            />
          </Field>
          <Field
            label={a.delivery.freeOverLabel}
            htmlFor={`${method?.id ?? "new"}-freeOver`}
            hint={a.common.optional}
          >
            <Input
              id={`${method?.id ?? "new"}-freeOver`}
              name="freeOver"
              inputMode="decimal"
              defaultValue={
                method?.freeOverCents !== null &&
                method?.freeOverCents !== undefined
                  ? centsToAmount(method.freeOverCents, currency)
                  : ""
              }
              placeholder="75.00"
            />
          </Field>
        </div>

        {/*
          Postage priced by what is in the box — spec 51.

          Only on `shipping`: a collection has no parcel, and a weight table
          beside "pick it up from the studio" is a control with nothing to
          price. Only on a plan that bought it, and gated again in the action
          because a form is not a gate.

          The fee above stays visible and stays meaningful: a `by_weight` rate
          with an empty table falls back to it, which is the half-configured
          state a seller passes through between ticking this box and typing the
          first row.
        */}
        {type === "shipping" && weightBands ? (
          <div className="space-y-3 rounded-xl border border-ink-100 p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="rateMode"
                value="by_weight"
                checked={byWeight}
                onChange={(e) => setByWeight(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 rounded border-ink-300"
              />
              <span>
                <span className="font-medium">{a.delivery.byWeight}</span>
                <span className="block text-xs text-ink-500">
                  {a.delivery.byWeightHint}
                </span>
              </span>
            </label>

            {byWeight ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs font-medium text-ink-500">
                  <span>{a.delivery.upToGrams}</span>
                  <span>{`${a.delivery.bandPrice} (${currency})`}</span>
                </div>
                {bandRows.map((band, i) => (
                  <div key={i} className="grid grid-cols-2 gap-2">
                    <Input
                      name={`band_${i}_upTo`}
                      type="number"
                      min={1}
                      inputMode="numeric"
                      aria-label={`${a.delivery.upToGrams} ${i + 1}`}
                      defaultValue={band?.upToGrams ?? ""}
                      placeholder={i === 0 ? "500" : ""}
                    />
                    <Input
                      name={`band_${i}_price`}
                      inputMode="decimal"
                      aria-label={`${a.delivery.bandPrice} ${i + 1}`}
                      defaultValue={
                        band ? centsToAmount(band.priceCents, currency) : ""
                      }
                      placeholder={i === 0 ? "3.50" : ""}
                    />
                  </div>
                ))}
                {/* The one thing a seller has to be told, because getting it
                    wrong stops their checkout rather than mispricing it. */}
                <p className="text-xs text-ink-500">{a.delivery.bandsCeiling}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {/*
          The same fee, in each currency the shop quotes — spec 53.

          Required, in the sense that leaving one blank keeps that currency off
          the storefront entirely. A basket in euros cannot be charged a fee in
          dollars, and nothing here converts one into the other, so the only
          honest alternative to a number the seller typed is not offering the
          currency at all.
        */}
        {regionalCurrencies.map((code) => (
          <div key={code} className="grid gap-4 sm:grid-cols-2">
            <Field
              label={`Fee (${code})`}
              htmlFor={`${method?.id ?? "new"}-fee-${code}`}
            >
              <Input
                id={`${method?.id ?? "new"}-fee-${code}`}
                name={`fee_${code}`}
                inputMode="decimal"
                defaultValue={centsToAmount(
                  priceIn(method ?? { currencyPrices: {} }, code)?.price ?? null,
                  code,
                )}
              />
            </Field>
            <Field
              label={`${a.delivery.freeOverLabel} (${code})`}
              htmlFor={`${method?.id ?? "new"}-freeOver-${code}`}
              hint={a.common.optional}
            >
              <Input
                id={`${method?.id ?? "new"}-freeOver-${code}`}
                name={`freeOver_${code}`}
                inputMode="decimal"
                defaultValue={centsToAmount(
                  priceIn(method ?? { currencyPrices: {} }, code)?.secondary ?? null,
                  code,
                )}
              />
            </Field>
          </div>
        ))}

        {/*
          Shipping only. Collection is a pickup at one fixed address, so where
          the buyer lives is not something the seller gets to filter on — and
          `saveDeliveryMethod` writes an empty zone for it whatever this form
          happens to be showing when the type is switched.

          No `htmlFor` on the field: what it labels is a radio pair and a list
          of checkboxes rather than one input, and the only input carrying the
          value is hidden — the last thing a label should point at. Each
          control inside names itself.
        */}
        {type === "shipping" ? (
          <Field label={a.delivery.shipsTo} help={a.delivery.zoneHelp}>
            <CountryPicker defaultCountries={method?.countries ?? []} />
          </Field>
        ) : null}

        {def.fields.map((field) =>
          field.multiline ? (
            <Field
              key={field.key}
              label={field.label}
              htmlFor={`${method?.id ?? "new"}-${field.key}`}
            >
              <Textarea
                id={`${method?.id ?? "new"}-${field.key}`}
                name={field.key}
                rows={2}
                defaultValue={config[field.key] ?? ""}
                placeholder={field.placeholder}
              />
            </Field>
          ) : (
            <Field
              key={field.key}
              label={field.label}
              htmlFor={`${method?.id ?? "new"}-${field.key}`}
            >
              <Input
                id={`${method?.id ?? "new"}-${field.key}`}
                name={field.key}
                defaultValue={config[field.key] ?? ""}
                placeholder={field.placeholder}
              />
            </Field>
          ),
        )}

        <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
          <label className="flex cursor-pointer items-center gap-2.5 pointer-coarse:min-h-11">
            <input
              type="checkbox"
              name="isEnabled"
              defaultChecked={method?.isEnabled ?? true}
              className="size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
            />
            <span className="text-sm font-medium">{a.delivery.offerAtCheckout}</span>
          </label>
          <Submit isEdit={Boolean(method)} />
        </div>
      </form>
    </Card>
  );
}
