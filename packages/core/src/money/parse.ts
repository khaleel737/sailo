/**
 * What a person typed, as minor units.
 *
 * Two ways in, because there are two situations:
 *
 *   moneyToCents   no locale available — infer the separator from the digits
 *   textToPrice    the locale is known — ask `Intl` and accept only its answer
 *
 * The second is strictly better and is not always possible. A CSV importer
 * reading a file somebody else produced has no locale to read it against; a
 * product editor on a seller's phone does. Both are kept, each documented with
 * the case the other cannot serve.
 */

import { currencyDecimals } from "./codes";

/* ===========================================================================
   Money as a human typed it, and back again

   These came from `apps/web/src/lib/utils.ts`, which is where they were written
   and where they could not stay: the seed scripts parse prices, the phone's
   product editor parses prices, and the importer parses prices. They were
   already importing `currencyDecimals` from this file — the minor-unit table is
   the whole reason they are correct — so they belong beside it.

   The asymmetry between the two directions is what once cost real money. A
   seller opened a JPY product and pressed Save without touching anything and
   ¥1,000 became ¥10, because the parse side knew each currency's minor unit and
   the render side divided by a flat 100. Both sides agreed afterwards, so
   nothing downstream could notice.
=========================================================================== */

/**
 * Which of the two separators in a number is the decimal point, if either.
 *
 * Sailo sells in 22 languages and both conventions are in daily use: "1,299.99"
 * across the US and UK, "1.299,99" across most of Europe, Turkey, Brazil and
 * Indonesia. Nothing asks the seller which they mean, so the string has to say.
 *
 * - Both separators present — the *later* one is the decimal point, because
 *   grouping always comes before the fraction in both conventions.
 * - One separator, appearing more than once — grouping. "1,234,567" and
 *   "1.234.567".
 * - A lone dot — always a decimal point. This is deliberately *not* symmetric
 *   with the comma rule below, and the asymmetry is the point: a lone dot has
 *   meant a decimal point here since the beginning, and treating "12.500" as
 *   twelve thousand five hundred multiplies a seller's price by a thousand.
 *   The cost is that a European writing "1.299" for one thousand two hundred
 *   and ninety-nine gets 1.30, which is wrong but is wrong in the direction
 *   this function has always been wrong in, and is visible on the page the
 *   moment they save. Resolving it properly needs the shop's locale, which
 *   this function is not given.
 * - A lone comma with exactly three digits behind it *and* a leading part that
 *   could really be a group — grouping. "1,299" is 1299.
 * - A lone comma otherwise — a decimal point. "12,5" is 12.50, which is the
 *   case that was missing and the reason any of this exists.
 */
/*
 * Not named `decimalSeparator`: that name is taken, by the function below that
 * is *given* the locale and asks `Intl` instead of guessing. Two functions
 * answering "which character is the decimal point" from opposite inputs — the
 * digits, or the reader — must not share a name.
 */
function guessSeparator(value: string): "." | "," | null {
  const lastDot = value.lastIndexOf(".");
  const lastComma = value.lastIndexOf(",");
  if (lastDot === -1 && lastComma === -1) return null;
  if (lastDot !== -1 && lastComma !== -1) return lastDot > lastComma ? "." : ",";

  const separator: "." | "," = lastDot === -1 ? "," : ".";
  const at = Math.max(lastDot, lastComma);

  // Only grouping repeats.
  if (value.indexOf(separator) !== at) return null;
  if (separator === ".") return ".";

  /*
   * A leading part that cannot be a thousands group means the comma is a
   * decimal point whatever follows it. "0,750" is seventy-five cents: no
   * grouped number begins with a lone zero.
   */
  const canGroup = /^[1-9]\d{0,2}$/.test(value.slice(0, at));
  return value.length - at - 1 === 3 && canGroup ? null : ",";
}

/**
 * Money as a human typed it, in minor units.
 *
 * This used to strip everything but digits and a dot, which silently read
 * "12,5" — an ordinary way to write €12.50 — as €125. A seller pricing in
 * euros, lira, reais or rupiah could overcharge by a factor of ten without a
 * single validation message, and the same string typed into the tax field was
 * already being read the other way.
 */
export function moneyToCents(
  value: string | number,
  currency = "USD",
): number | null {
  /*
   * The multiplier is the currency's, not a flat 100. A seller pricing at
   * ¥1,000 types 1000; multiplying that by 100 stored ¥100,000 and Stripe
   * charged it, because JPY's minor unit is the yen itself.
   */
  const per = 10 ** currencyDecimals(currency);

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.round(value * per)) : null;
  }

  const cleaned = String(value).replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;

  const separator = guessSeparator(cleaned);
  const normalized = separator
    ? cleaned.replace(separator === "." ? /,/g : /\./g, "").replace(separator, ".")
    : cleaned.replace(/[.,]/g, "");

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n * per));
}

/**
 * The same, for a caller that must end up with a number.
 *
 * A price input on a form has nowhere to put "that wasn't a number", so it
 * settles for zero. An importer does — an unusable cell there means "inherit
 * from the product", which is not the same as free — so it calls
 * `moneyToCents` and keeps the null. Collapsing the two is how a variant whose
 * price column held a stray "-" went live costing nothing.
 */
export function parseMoneyToCents(value: string | number, currency = "USD"): number {
  return moneyToCents(value, currency) ?? 0;
}

/**
 * The inverse of `moneyToCents`: minor units to the plain decimal string an
 * `<input>` shows and a CSV column holds. Null stays empty, because a blank
 * price means "inherit" and `0` means free.
 *
 * This is the half of the pair that a currency-awareness pass missed, and the
 * asymmetry cost real money. Every edit form renders the stored amount into a
 * text field and saves whatever comes back through `parseMoneyToCents`, which
 * has known each currency's minor unit since seventy-one of them were added.
 * The render side still divided by a flat 100 — so a seller who opened a JPY
 * product and pressed Save without touching anything turned ¥1,000 into ¥10,
 * and a KWD seller turned 12.500 KWD into 125.000 and charged their buyer ten
 * times the price. Both sides agreed with each other afterwards, so nothing
 * downstream could notice: `connect.ts` re-checks the Stripe lines against the
 * order subtotal, and both were corrupt together.
 *
 * No grouping separators and always `.` for the decimal, because the output is
 * parsed again rather than read — `formatMoney` is what a human should see.
 */
export function centsToAmount(
  minor: number | null | undefined,
  currency = "USD",
): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "";
  const decimals = currencyDecimals(currency);
  return (minor / 10 ** decimals).toFixed(decimals);
}

/* ===========================================================================
   Money as a human types it, when the locale is known

   These came from `apps/mobile/components/money.ts`, and they are the better
   half of a pair this file already had.

   `moneyToCents` above infers the decimal separator from the digits, and its own
   comment names the case it gets wrong: *"a European writing '1.299' for one
   thousand two hundred and ninety-nine gets 1.30 … Resolving it properly needs
   the shop's locale, which this function is not given."*

   `textToPrice` below is given the locale, so it does resolve it properly — it
   asks `Intl` which character this reader uses and accepts only that. The phone
   has had this all along while the web guessed, from two functions doing one job.

   Both are kept. A caller that has a locale should use this pair; the CSV
   importer, which is reading a file somebody else produced and has no locale to
   read it against, cannot and uses the inference above.
=========================================================================== */


/**
 * The character this locale puts between the units and the fraction.
 *
 * Asked of `Intl` rather than assumed: a seller typing `12,50` in French means
 * twelve fifty, and the same keystrokes in English mean one thousand two
 * hundred and fifty. Both are reachable from a phone keypad, so the only safe
 * answer is the one the reader's own locale gives.
 */
export function decimalSeparator(locale: string): string {
  /*
   * Guarded for the same reason `formatMoney` is, and it was not: a malformed
   * language tag makes `new Intl.NumberFormat` throw `RangeError`, and the tag
   * arrives from a device setting, not from us. The two functions are called
   * from the same screen with the same value — the price a seller reads and the
   * price field they type into — so one of them degrading while the other
   * crashes the editor is the worst of both.
   */
  try {
    return (
      new Intl.NumberFormat(locale)
        .formatToParts(1.1)
        .find((part) => part.type === "decimal")?.value ?? "."
    );
  } catch {
    return ".";
  }
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

/**
 * A whole count — units in stock, minutes, days, download limits.
 *
 * Blank stays blank, which is "not counting".
 *
 * WHY IT STOPS AT A SEPARATOR RATHER THAN STRIPPING EVERYTHING
 *
 * It used to be `text.replace(/[^0-9]/g, "")`, which read "12.5" as **125**.
 * That is the same tenfold mistake `moneyToCents` above exists to prevent, on
 * fields where it is just as expensive: `durationMinutes` on a booking,
 * `trialDays` on a membership, `stockQuantity` on a product. A fraction of a
 * count is not meaningful, so the whole part is what the seller meant.
 *
 * A leading minus is still stripped rather than refused. No count is negative
 * and a number pad cannot produce one, so "-3" is a paste or a stray keypress,
 * and 3 is a better reading of it than "stop tracking stock" — which is what
 * `null` means to the caller on that field.
 */
export function textToCount(text: string): number | null {
  const [whole = ""] = text.split(/[.,]/);
  const digits = whole.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}
