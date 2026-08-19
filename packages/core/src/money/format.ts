/**
 * A number of minor units, as something a person reads.
 *
 * One direction only. The other is `./parse`, and the asymmetry between them is
 * what once cost real money: a JPY product opened and saved turned ¥1,000 into
 * ¥10 because the parse side knew each currency's minor unit and the render side
 * divided by a flat 100. Keeping them in separate files does not prevent that —
 * only `./codes` being the single answer to "how many places" does — but it does
 * make each file readable in one sitting.
 */

import { currencyDecimals } from "./codes";

/**
 * A price, written the way the surface it sits on is written.
 *
 * Lives here rather than in apps/web because it is not a web concern: it is
 * the display half of the same fact `currencyDecimals` above encodes, and the
 * mobile app has to reach the identical answer. It used to sit in
 * `apps/web/src/lib/utils.ts`, which a React Native bundle cannot import at
 * all — so a phone screen's only options were to divide by 100 by hand, which
 * is exactly the bug this whole module exists to prevent, or to copy the
 * function and let the two drift.
 *
 * `locale` decides the separators and where the symbol goes: a German page
 * says `1.234,56 €`, a French one `1 234,56 €`, and only an English one says
 * `€1,234.56`. It was hardcoded to `en-US` for everyone, which meant every
 * price on every storefront was punctuated in a way most of the world reads
 * as wrong — and `1.234` means one thing to a German reader and something a
 * thousand times larger to an American one, so this is not only cosmetic.
 *
 * `-u-nu-latn` pins the digits to 0-9. Arabic and a few other locales would
 * otherwise render their own numerals, which is correct by the standard but
 * is a change no seller asked for and every one of their buyers would notice.
 * Everything else about the locale — separators, symbol position, the RTL
 * marks Arabic needs — is left alone.
 *
 * Defaults to `en-US` rather than to the machine's locale: undefined would
 * make a server's own configuration decide what a buyer sees, and the staff
 * panel is deliberately English.
 */
export function formatMoney(minor: number, currency = "USD", locale = "en-US") {
  /*
   * How many minor units make one of this currency, rather than a flat 100.
   * ¥1,000 is a thousand minor units, not a hundred thousand, and dividing by
   * 100 showed a seller pricing in yen a hundredth of what they charged.
   */
  const decimals = currencyDecimals(currency);
  const per = 10 ** decimals;

  try {
    return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
      style: "currency",
      currency,
      // A whole amount drops its fraction — "$20", not "$20.00" — while
      // anything with a remainder shows every place the currency has, so a
      // price never appears truncated. On a zero-decimal currency both
      // branches are zero, which is the correct answer for yen.
      minimumFractionDigits: minor % per === 0 ? 0 : decimals,
      maximumFractionDigits: decimals,
    }).format(minor / per);
  } catch {
    return `${(minor / per).toFixed(decimals)} ${currency}`;
  }
}

/**
 * Just the symbol — `£`, `€`, `kr`, `¥` — for a field the buyer types into.
 *
 * Asked of `Intl` rather than kept in a table of our own, for the same reason
 * `currencyLabel` below is: seventy-one currencies across thirty-five locales
 * is a table nobody could keep right, and the runtime already has it. Taken
 * from `formatToParts` rather than by stripping digits out of a formatted
 * string, which breaks on every locale that puts a non-breaking space between
 * the symbol and the number.
 *
 * The symbol and not the code, because a buyer reading `kr` knows where they
 * are and a buyer reading `SEK` is doing a lookup. Falls back to the code,
 * which is a worse label and never a wrong one.
 */
export function currencySymbol(code: string, locale = "en-US"): string {
  try {
    return (
      new Intl.NumberFormat(`${locale}-u-nu-latn`, { style: "currency", currency: code })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? code
    );
  } catch {
    return code;
  }
}

/**
 * "JPY — Japanese Yen", in the reader's own language.
 *
 * `Intl.DisplayNames` already ships every one of these translated, in every
 * locale the app supports, so the picker gets seventy-one localised names for
 * no dictionary keys and nothing to maintain. The code stays in front because
 * it is what a seller recognises and what appears on their Stripe dashboard.
 *
 * Falls back to the bare code where a runtime has no display names for the
 * locale — a list of codes is worse than a list of names, and far better than
 * an empty dropdown.
 */
export function currencyLabel(code: string, locale = "en"): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "currency" }).of(code);
    return name && name !== code ? `${code} — ${name}` : code;
  } catch {
    return code;
  }
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
