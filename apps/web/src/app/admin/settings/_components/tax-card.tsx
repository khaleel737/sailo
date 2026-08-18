"use client";

import { useState } from "react";
import { Alert, Card, Field, Input, Select } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { Shop } from "@sailo/db/schema";

/**
 * Who works out the tax, and at what rate when the answer is "we do".
 *
 * The mode is the first control on the card because it decides whether the
 * three below it mean anything. Under Stripe Tax the rate is never consulted —
 * `computeTotals` skips its own arithmetic entirely — so leaving a stale "20"
 * visible and editable underneath would be the card telling a seller it charges
 * something it does not. The manual fields are hidden rather than disabled for
 * the same reason a disabled field is the wrong answer on the invoicing card:
 * greyed-out controls invite a hunt for the switch that un-greys them.
 *
 * Client state rather than a server round-trip, because this is a preview of
 * what the seller is about to save and nothing is saved until they press the
 * button at the bottom of the form.
 */
export function TaxCard({ shop }: { shop: Shop }) {
  const a = useAdminT();
  const [mode, setMode] = useState(shop.taxMode === "stripe" ? "stripe" : "manual");
  const stripeMode = mode === "stripe";

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{a.settings.tax}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.settings.taxBody}</p>
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

      <Field
        label={a.settings.taxMode}
        htmlFor="taxMode"
        hint={a.settings.taxModeHint}
      >
        <Select
          id="taxMode"
          name="taxMode"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="manual">{a.settings.taxModeManual}</option>
          <option value="stripe">{a.settings.taxModeStripe}</option>
        </Select>
      </Field>

      {stripeMode ? (
        <>
          {/*
            Two things a seller must know before this works, stated here rather
            than discovered as a Stripe error at somebody's checkout. Neither is
            something Sailo can do on their behalf: the registrations are legal
            positions only they can take, and Stripe will refuse to create a
            session until the origin address is set.
          */}
          {shop.stripeAccountId ? (
            <Alert tone="info">{a.settings.taxStripeSetup}</Alert>
          ) : (
            <Alert tone="warning">{a.settings.taxStripeNoAccount}</Alert>
          )}

          <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
            <input
              type="checkbox"
              name="taxIdCollection"
              defaultChecked={shop.taxIdCollection}
              className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
            />
            <span>
              <span className="block text-sm font-medium">
                {a.settings.taxIdCollection}
              </span>
              <span className="block text-xs text-ink-500">
                {a.settings.taxIdCollectionBody}
              </span>
            </span>
          </label>
        </>
      ) : null}

      {/*
        The name survives both modes. Stripe computes the amount but the word
        beside it on the invoice is still the shop's own — "VAT", "GST", "IVA" —
        and `taxLabel` reads it for every order either way.
      */}
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

        {!stripeMode ? (
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
              defaultValue={shop.taxRateBp ? String(shop.taxRateBp / 100) : ""}
              placeholder="20"
            />
          </Field>
        ) : (
          /*
           * The rate is still submitted, unchanged, while the field is hidden.
           *
           * Without this the form would post no `taxRate` at all and
           * `readTaxRateBp` would write a zero — so a seller who tried Stripe
           * Tax, saved, and switched back would find their 20% silently gone.
           */
          <input
            type="hidden"
            name="taxRate"
            value={shop.taxRateBp ? String(shop.taxRateBp / 100) : ""}
          />
        )}
      </div>

      {!stripeMode ? (
        <>
          <Field label={a.settings.taxShown} htmlFor="taxInclusive">
            <Select
              id="taxInclusive"
              name="taxInclusive"
              defaultValue={shop.taxInclusive ? "inclusive" : "exclusive"}
            >
              <option value="exclusive">{a.settings.taxExclusive}</option>
              <option value="inclusive">{a.settings.taxInclusive}</option>
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
        </>
      ) : (
        <>
          {/*
            Both still matter under Stripe Tax and neither is a free choice
            there, which is why they are shown as one statement rather than two
            controls. `taxInclusive` becomes the `tax_behavior` on every line
            item — it is what tells Stripe whether the price already contains
            the tax — so it is offered, while `taxOnDelivery` is not: Stripe
            already knows which jurisdictions tax shipping, and a seller
            overriding that is the seller getting it wrong.
          */}
          <Field label={a.settings.taxShown} htmlFor="taxInclusiveStripe">
            <Select
              id="taxInclusiveStripe"
              name="taxInclusive"
              defaultValue={shop.taxInclusive ? "inclusive" : "exclusive"}
            >
              <option value="exclusive">{a.settings.taxExclusive}</option>
              <option value="inclusive">{a.settings.taxInclusive}</option>
            </Select>
          </Field>
          <input
            type="hidden"
            name="taxOnDelivery"
            value={shop.taxOnDelivery ? "on" : ""}
          />
          <p className="text-xs text-ink-500">{a.settings.taxStripeDelivery}</p>
        </>
      )}

      <Field label={a.settings.taxId} htmlFor="taxId" hint={a.settings.taxIdHint}>
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
