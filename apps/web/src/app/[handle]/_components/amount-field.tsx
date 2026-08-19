"use client";

import { useId } from "react";
import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";
import {
  centsToAmount,
  currencySymbol,
  formatMoney,
  moneyToCents,
} from "@sailo/core/currency";

/**
 * "Name your price" — the one field in the whole checkout a buyer types money
 * into. Spec 43.
 *
 * Everywhere else the price is read from the database and the browser is not
 * asked; here the amount *is* the buyer's answer, so there is nowhere else it
 * could come from. That makes this component the polite half of a rule whose
 * strict half lives in `resolveLines`: nothing typed here is trusted, the floor
 * is enforced again on the server, and a request that skips this field entirely
 * is clamped to the same number.
 *
 * WHY THE PARSE GOES THROUGH `moneyToCents`
 *
 * Because `parseFloat(x) * 100` is the exact defect this repo has already paid
 * for once. Sailo sells in seventy-one currencies: five of them are quoted to
 * three decimals, JPY has no minor unit at all, and both conventions for the
 * decimal separator are in daily use across the languages the storefront ships
 * in. `moneyToCents` knows all of that; a multiplication does not, and it is
 * wrong in the direction that charges somebody ten times the price.
 *
 * The value is held as the *string the buyer typed* rather than as cents, so
 * "12." and "0," survive mid-keystroke instead of collapsing to a number and
 * fighting the cursor. Cents are derived on every change and handed up.
 */
export function AmountField({
  currency,
  locale,
  /** The seller's floor, in minor units. Zero means free is allowed. */
  floorCents,
  value,
  onChange,
  t,
}: {
  currency: string;
  locale?: string;
  floorCents: number;
  /** What the buyer has typed, as they typed it. */
  value: string;
  onChange: (next: { text: string; cents: number }) => void;
  t: Dictionary;
}) {
  const id = useId();
  const cents = moneyToCents(value, currency) ?? 0;
  /*
   * Below the floor, said while they are still typing.
   *
   * Only once there is something to judge: an empty field on a form nobody has
   * touched is not an error, and marking it as one the moment the sheet opens
   * is how a checkout reads as broken before the buyer has done anything.
   */
  const short = value.trim() !== "" && cents < floorCents;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {t.pricing.nameYourPrice}
      </label>
      <div className="surface-elevated flex items-center gap-2 rounded-xl px-3">
        {/* The symbol, not the code: a buyer reading "kr" knows where they
            are and a buyer reading "SEK" is doing a lookup. */}
        <span className="text-muted shrink-0 text-sm tabular-nums">
          {currencySymbol(currency, locale)}
        </span>
        <input
          id={id}
          name="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) =>
            onChange({
              text: e.target.value,
              cents: moneyToCents(e.target.value, currency) ?? 0,
            })
          }
          aria-describedby={`${id}-floor`}
          aria-invalid={short || undefined}
          className="h-12 w-full min-w-0 bg-transparent text-base font-semibold tabular-nums outline-none"
        />
      </div>
      <p
        id={`${id}-floor`}
        className={`text-xs ${short ? "font-medium text-amber-600" : "text-muted"}`}
      >
        {/*
          A floor of zero is not "at least nothing" — it is the seller saying
          this may be free, which is the whole of a donation. Saying "at least
          £0.00" instead would read as a bug on the one product where free is
          the point.
        */}
        {floorCents > 0
          ? interpolate(t.pricing.atLeast, {
              amount: formatMoney(floorCents, currency, locale),
            })
          : t.pricing.payAnything}
      </p>
    </div>
  );
}

/**
 * What the field should open on, as text.
 *
 * Rendered through `centsToAmount` rather than a division, for the other half
 * of the reason above: the render side of this pair once divided by a flat 100
 * while the parse side knew each currency's minor unit, and a seller who opened
 * a JPY product and pressed save turned ¥1,000 into ¥10. Both directions ask
 * the same table now.
 */
export function suggestedText(suggestedCents: number, currency: string): string {
  return suggestedCents > 0 ? centsToAmount(suggestedCents, currency) : "";
}
