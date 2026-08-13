import { currencyDecimals } from "@sailo/core/currency";

/**
 * Money, rendered the way the rest of Sailo renders it.
 *
 * The one rule that matters is imported rather than assumed: `currencyDecimals`
 * knows that a yen is its own minor unit and a dinar has three, so this divides
 * by the right power of ten instead of a flat 100. Dividing by 100 unconditionally
 * is the bug `@sailo/core/currency` exists to prevent — it shows a seller pricing
 * in JPY a hundredth of what they actually charged — and a second copy of that
 * arithmetic on the phone is exactly how the two surfaces drift apart.
 *
 * This deliberately mirrors `formatMoney` in apps/web rather than importing it:
 * that one lives in `apps/web/src/lib/utils.ts`, which is app-local and pulls in
 * web-only helpers. The *shared* half — the decimals table — is what both call,
 * so the number is the same on both and only the `Intl` call is duplicated.
 * Promoting the formatter into `@sailo/core` would remove even that, and is the
 * obvious follow-up the moment a third surface needs it.
 *
 * Amounts arrive as integer minor units on every order column (`totalCents`,
 * `unitPriceCents`, …), which is what the database stores and what Stripe charges.
 */
export function formatMoney(minor: number, currency = "USD", locale = "en-US"): string {
  const decimals = currencyDecimals(currency);
  const per = 10 ** decimals;

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      /*
       * A whole amount drops its fraction — "$20", not "$20.00" — while anything
       * with a remainder shows every place the currency has. Both branches are
       * zero on a zero-decimal currency, which is the correct answer for yen.
       */
      minimumFractionDigits: minor % per === 0 ? 0 : decimals,
      maximumFractionDigits: decimals,
    }).format(minor / per);
  } catch {
    /*
     * Hermes ships a narrower ICU than a browser's, and an unrecognised currency
     * code throws rather than degrading. A bare number with the code beside it is
     * still a truthful price; a crashed screen is not.
     */
    return `${(minor / per).toFixed(decimals)} ${currency}`;
  }
}
