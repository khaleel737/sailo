"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, Field, Input } from "@sailo/design-system/web";
import { centsToAmount } from "@sailo/core/currency";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@sailo/i18n";
import { ChoiceGroup } from "./choice-group";
import { Toggle } from "./toggle";
import type { ProductWithRelations } from "./product.types";
import { localMoment } from "@/app/admin/products/_lib/local-moment";

/**
 * How the price is arrived at, and when the product is on sale — spec 43.
 *
 * One card for two features, because from the seller's side they are one
 * decision: the price stops being a single number typed once. Splitting them
 * into two cards would put "name your price" and "sales close on Friday" a
 * screen apart, and a seller running a weekend name-your-price fundraiser is
 * setting both in the same minute.
 *
 * WHY IT IS NOT IN THE KIND PANEL
 *
 * The panel holds what differs by kind. These do not: a launch window is as
 * meaningful on a run of mugs as on a download, and a donation is a digital
 * product with a floor of zero rather than a kind of its own. So the card sits
 * with the price it modifies, outside the panel, next to the four things every
 * kind has.
 *
 * A membership is the one exception and it is a refusal rather than a variation:
 * a recurring buyer-chosen amount is a Stripe Price per buyer, so the mode
 * switch is not offered there at all and `saveProduct` refuses it if it arrives
 * anyway.
 */
export function PricingCard({
  product,
  currency,
  /** The shop's zone, so the two date fields are labelled with a real clock. */
  timeZone,
  /** Whether the plan includes any of this. False renders the upgrade note. */
  allowed,
  /** The cheapest plan that does, for the sentence that names it. */
  upgradeTo,
}: {
  product?: ProductWithRelations;
  currency: string;
  timeZone: string;
  allowed: boolean;
  upgradeTo: string | null;
}) {
  const a = useAdminT();

  const [mode, setMode] = useState<"fixed" | "pwyw">(() =>
    product?.pricingMode === "pwyw" ? "pwyw" : "fixed",
  );

  /*
   * Locked, not hidden.
   *
   * A seller on Free who has read the pricing page and come looking for
   * name-your-price should find it here with the reason beside it, rather than
   * a card that does not exist. The fields are omitted rather than disabled so
   * nothing is posted at all — `saveProduct` ignores them on a plan that has
   * not bought them either way, which is the half that actually decides.
   */
  if (!allowed) {
    return (
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-900">
          {a.productForm.pricingTitle}
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
          {upgradeTo
            ? interpolate(a.productForm.pricingLocked, { plan: upgradeTo })
            : a.productForm.pricingBody}
        </p>
        <Link
          href="/admin/billing"
          className="focus-ring mt-3 inline-flex items-center gap-1 rounded text-xs font-medium text-brand-700 transition hover:text-brand-800 pointer-coarse:min-h-11"
        >
          {a.common.upgrade}
          <ArrowUpRight className="size-3.5" />
        </Link>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.productForm.pricingTitle}
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
          {a.productForm.pricingBody}
        </p>
      </div>

      {/* The value the form posts. `ChoiceGroup` is a radio group rather than
          a set of inputs, so the chosen value rides a hidden field — the same
          shape the digital-delivery card uses two files away. */}
      <input type="hidden" name="pricingMode" value={mode} />

      <ChoiceGroup
        variant="tile"
        ariaLabel={a.productForm.pricingTitle}
        value={mode}
        onChange={setMode}
        options={[
          {
            value: "fixed" as const,
            label: a.productForm.modeFixed,
            description: a.productForm.modeFixedHint,
          },
          {
            value: "pwyw" as const,
            label: a.productForm.modePwyw,
            description: a.productForm.modePwywHint,
          },
        ]}
      />

      {mode === "pwyw" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {/*
            Blank and zero are different answers here, and the help text is
            where a seller finds that out. Blank means "at least the list
            price"; 0 means free is allowed, which is the whole of a donation.
            The server keeps them apart — `optionalCents` answers null for an
            empty box — so the only thing that has to be right is that somebody
            filling this in knows which one they are choosing.
          */}
          <Field
            label={interpolate(a.productForm.minPrice, { currency })}
            htmlFor="minPrice"
            hint={a.common.optional}
            help={a.productForm.minPriceHint}
          >
            <Input
              id="minPrice"
              name="minPrice"
              inputMode="decimal"
              defaultValue={
                product?.minPriceCents !== null && product?.minPriceCents !== undefined
                  ? centsToAmount(product.minPriceCents, currency)
                  : ""
              }
              placeholder="0"
            />
          </Field>

          <Field
            label={interpolate(a.productForm.suggestedPrice, { currency })}
            htmlFor="suggestedPrice"
            hint={a.common.optional}
            help={a.productForm.suggestedPriceHint}
          >
            <Input
              id="suggestedPrice"
              name="suggestedPrice"
              inputMode="decimal"
              defaultValue={
                product?.suggestedPriceCents !== null &&
                product?.suggestedPriceCents !== undefined
                  ? centsToAmount(product.suggestedPriceCents, currency)
                  : ""
              }
              placeholder="10.00"
            />
          </Field>
        </div>
      ) : null}

      <div className="border-t border-ink-100 pt-4">
        <h3 className="text-sm font-semibold text-ink-900">
          {a.productForm.sellWindowTitle}
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
          {interpolate(a.productForm.sellWindowBody, { zone: timeZone })}
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label={a.productForm.sellFrom}
            htmlFor="sellFrom"
            hint={a.common.optional}
          >
            <Input
              id="sellFrom"
              name="sellFrom"
              type="datetime-local"
              defaultValue={localMoment(product?.sellFrom ?? null, timeZone)}
            />
          </Field>
          <Field
            label={a.productForm.sellUntil}
            htmlFor="sellUntil"
            hint={a.common.optional}
          >
            <Input
              id="sellUntil"
              name="sellUntil"
              type="datetime-local"
              defaultValue={localMoment(product?.sellUntil ?? null, timeZone)}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Toggle
            name="hideWhenUnavailable"
            label={a.productForm.hideWhenUnavailable}
            description={a.productForm.hideWhenUnavailableBody}
            defaultChecked={product?.hideWhenUnavailable ?? false}
          />
        </div>
      </div>
    </Card>
  );
}
