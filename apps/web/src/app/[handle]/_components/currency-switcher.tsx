import { currencyLabel, formatMoney } from "@sailo/core/currency";
import type { Dictionary } from "@sailo/i18n";
import type { Locale } from "@sailo/i18n/config";
import { setStorefrontCurrency } from "@/lib/actions/currency";
import { cn } from "@sailo/design-system/web/cn";

/**
 * Which currency this visitor is being quoted in, and the others on offer.
 *
 * Spec 53. A plain form posting to a server action — no client component, no
 * `router.refresh()`, no state. A form action re-renders the route when it
 * returns, which is exactly the behaviour wanted, and it means the control
 * works before any JavaScript has loaded on a storefront whose buyers are
 * frequently on a phone on mobile data.
 *
 * Renders **nothing** when there is one option, which is every shop that has
 * not enabled a second currency. A switcher with one entry is a control that
 * teaches a visitor there is a choice and then refuses to offer one.
 */
export function CurrencySwitcher({
  current,
  options,
  locale,
  t,
}: {
  current: string;
  /** The shop's own first, then whatever is live. */
  options: string[];
  locale: Locale;
  t: Dictionary;
}) {
  if (options.length < 2) return null;

  return (
    <form action={setStorefrontCurrency} className="inline-flex">
      <fieldset className="surface-card inline-flex items-center gap-0.5 rounded-full p-0.5">
        {/*
          A legend rather than an `aria-label` on the fieldset: the visible text
          is the currency code on each button, and a screen reader meeting
          "EUR" with no context has no way to know what kind of thing it is.
        */}
        <legend className="sr-only">{t.shop.currencyLabel}</legend>

        {options.map((code) => (
          <button
            key={code}
            type="submit"
            name="currency"
            value={code}
            /*
             * The full name in the accessible label, the code on the face.
             * `currencyLabel` is `Intl.DisplayNames`, so this is translated in
             * all thirty-five locales for no dictionary keys — the same trade
             * the seller's currency picker already makes.
             *
             * `aria-current` rather than `disabled` on the active one: a
             * disabled button is skipped by a screen reader's control list, so
             * the currency the visitor is actually in would be the one option
             * they could not hear.
             */
            aria-label={currencyLabel(code, locale)}
            aria-current={code === current ? "true" : undefined}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition pointer-coarse:min-h-11 pointer-coarse:px-4 hover:opacity-70",
              code === current && "surface-elevated",
            )}
          >
            {/*
              The symbol, not the code, where the two differ visibly — `€` is
              what a buyer scans for and `EUR` is what they read. `formatMoney`
              of zero is the cheapest way to ask Intl for the symbol in this
              locale's own placement, and the digits are stripped back off.
            */}
            <span aria-hidden>{symbolOf(code, locale)}</span>
            <span className="sr-only">{code}</span>
          </button>
        ))}
      </fieldset>
    </form>
  );
}

/**
 * The currency's symbol as this locale writes it, or the bare code.
 *
 * Asked of `Intl` through `formatMoney` rather than kept as a table: a table of
 * symbols is a second place for a currency to be described, and the one that
 * would quietly rot. Zero formats to something like `€0.00`, and everything
 * that is not a symbol comes back off.
 */
function symbolOf(code: string, locale: string): string {
  const stripped = formatMoney(0, code, locale)
    .replace(/[\d\s.,  ]/g, "")
    .trim();
  return stripped || code;
}
