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

/**
 * The character this locale puts between the units and the fraction.
 *
 * Asked of `Intl` rather than assumed: a seller typing `12,50` in French means
 * twelve fifty, and the same keystrokes in English mean one thousand two
 * hundred and fifty. Both are reachable from a phone keypad, so the only safe
 * answer is the one the reader's own locale gives.
 */
export function decimalSeparator(locale: string): string {
  return (
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value ?? "."
  );
}

/**
 * Minor units, as something to type over.
 *
 * Not `toFixed(2)`. `currencyDecimals` is the function `formatMoney` itself
 * asks, so a yen price opens as `1000` rather than `1000.00` and a dinar price
 * keeps all three of its places. The two-decimal assumption this avoids is the
 * one that shows a seller a hundredth of what they charge.
 */
export function priceToText(minor: number, currency: string, locale: string): string {
  const decimals = currencyDecimals(currency);
  if (decimals === 0) return String(Math.trunc(minor));
  return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: false,
  }).format(minor / 10 ** decimals);
}

/**
 * What the seller typed, as minor units — or null if it is not a number yet.
 *
 * Null and zero are kept apart deliberately: a blank compare-at price means "no
 * strike-through" and zero means "free", and a parser answering 0 for an empty
 * field would advertise every product as reduced to nothing.
 *
 * Everything that is not a digit or *this locale's* decimal separator is
 * dropped, which is what makes `1 234,50`, `1.234,50` and `1234,50` one price
 * in French. The digits are Latin because `priceToText` writes them that way,
 * for the reason `formatMoney`'s own `-u-nu-latn` note gives.
 */
export function textToPrice(text: string, currency: string, locale: string): number | null {
  const separator = decimalSeparator(locale);
  const cleaned = text
    .split("")
    .filter((ch) => /[0-9]/.test(ch) || ch === separator)
    .join("")
    .replace(separator, ".");
  if (!cleaned || cleaned === ".") return null;

  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 10 ** currencyDecimals(currency));
}

/** A whole count — units in stock. Blank stays blank, which is "not counting". */
export function textToCount(text: string): number | null {
  const digits = text.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}
