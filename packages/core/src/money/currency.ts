/**
 * The currencies a shop may price in, and how many minor units each one has.
 *
 * WHY THE MINOR-UNIT COUNT IS THE POINT
 *
 * Every amount in this codebase is stored as an integer in the currency's
 * smallest unit — the column is called `priceCents` for the same reason
 * everyone says "cents", not because every currency has them. That storage is
 * already correct for Stripe: `unit_amount` is documented in the smallest
 * unit, so `connect.ts` hands the stored integer straight over and charges
 * exactly what was saved.
 *
 * What was not correct is everything either side of it. Display divided by
 * 100 and input multiplied by 100, both unconditionally. For the eighteen
 * currencies previously on offer that happened to be right, because all
 * eighteen have two decimals. It stops being right the moment the list grows:
 *
 *   - A seller pricing at ¥1,000 types 1000. Multiplied by 100 that stores
 *     100,000 minor units, and JPY's minor unit *is* the yen — so Stripe
 *     charges ¥100,000. A hundred times the intended price.
 *   - The same seller's dashboard then divides by 100 and shows ¥1,000, so
 *     nothing on screen contradicts them until a buyer is charged.
 *
 * Hence `decimals`. It is the single fact that makes storage, display, input
 * and the Stripe handoff agree, and it is why this table exists rather than a
 * bare array of codes.
 *
 * The values follow Stripe's definition rather than the ISO one where the two
 * differ, because Stripe's is what decides the amount actually taken from a
 * buyer's card. Display then follows the same table, so what a seller sees and
 * what Stripe charges cannot drift apart.
 */

export type CurrencyDef = {
  code: string;
  /**
   * Minor units per major unit, as a power of ten.
   *
   * 0 — the smallest unit is the currency itself. ¥1 is one unit, not 100.
   * 2 — the ordinary case.
   * 3 — Gulf dinars. Stripe accepts these but requires the amount to be a
   *     multiple of ten, because card networks settle them to two places.
   */
  decimals: 0 | 2 | 3;
};

/*
 * Grouped by region purely so a human can audit the list. Order within the
 * exported array is what the picker shows, and that is deliberately
 * "most likely first" rather than alphabetical: the top of a sixty-item
 * dropdown is the only part most sellers will read.
 */
const DEFS: CurrencyDef[] = [
  // The ones most shops want, in rough order of how often they are wanted.
  { code: "USD", decimals: 2 },
  { code: "EUR", decimals: 2 },
  { code: "GBP", decimals: 2 },

  // Middle East and North Africa.
  { code: "AED", decimals: 2 },
  { code: "SAR", decimals: 2 },
  { code: "ILS", decimals: 2 },
  { code: "QAR", decimals: 2 },
  { code: "JOD", decimals: 3 },
  { code: "KWD", decimals: 3 },
  { code: "BHD", decimals: 3 },
  { code: "OMR", decimals: 3 },
  { code: "EGP", decimals: 2 },
  { code: "LBP", decimals: 2 },
  { code: "MAD", decimals: 2 },
  { code: "TND", decimals: 3 },
  { code: "DZD", decimals: 2 },
  { code: "TRY", decimals: 2 },

  // South and South-East Asia.
  { code: "INR", decimals: 2 },
  { code: "PKR", decimals: 2 },
  { code: "BDT", decimals: 2 },
  { code: "LKR", decimals: 2 },
  { code: "NPR", decimals: 2 },
  { code: "IDR", decimals: 2 },
  { code: "MYR", decimals: 2 },
  { code: "SGD", decimals: 2 },
  { code: "THB", decimals: 2 },
  { code: "PHP", decimals: 2 },
  { code: "VND", decimals: 0 },

  // East Asia.
  { code: "JPY", decimals: 0 },
  { code: "CNY", decimals: 2 },
  { code: "HKD", decimals: 2 },
  { code: "TWD", decimals: 2 },
  { code: "KRW", decimals: 0 },

  // Central Asia and the Caucasus.
  { code: "KZT", decimals: 2 },
  { code: "AZN", decimals: 2 },
  { code: "AMD", decimals: 2 },

  // Europe outside the euro.
  { code: "CHF", decimals: 2 },
  { code: "PLN", decimals: 2 },
  { code: "CZK", decimals: 2 },
  { code: "HUF", decimals: 2 },
  { code: "RON", decimals: 2 },
  { code: "BGN", decimals: 2 },
  { code: "UAH", decimals: 2 },
  { code: "RSD", decimals: 2 },
  { code: "GEL", decimals: 2 },
  /*
   * The Balkans, added because the gap was visible from the other side: Sailo
   * ships a fully translated dashboard in Macedonian, Albanian and Bosnian,
   * and a seller reading it could not price in their own money.
   */
  { code: "MKD", decimals: 2 },
  { code: "ALL", decimals: 2 },
  { code: "BAM", decimals: 2 },
  { code: "MDL", decimals: 2 },

  // Scandinavia and the Nordics.
  { code: "SEK", decimals: 2 },
  { code: "NOK", decimals: 2 },
  { code: "DKK", decimals: 2 },
  { code: "ISK", decimals: 2 },

  // Africa.
  { code: "NGN", decimals: 2 },
  { code: "KES", decimals: 2 },
  { code: "ZAR", decimals: 2 },
  { code: "GHS", decimals: 2 },
  { code: "TZS", decimals: 2 },
  { code: "UGX", decimals: 0 },
  { code: "RWF", decimals: 0 },
  { code: "ETB", decimals: 2 },
  { code: "ZMW", decimals: 2 },
  { code: "MUR", decimals: 2 },
  { code: "XOF", decimals: 0 },
  { code: "XAF", decimals: 0 },

  // The Americas and Oceania.
  { code: "CAD", decimals: 2 },
  { code: "MXN", decimals: 2 },
  { code: "BRL", decimals: 2 },
  { code: "ARS", decimals: 2 },
  { code: "CLP", decimals: 0 },
  { code: "COP", decimals: 2 },
  { code: "PEN", decimals: 2 },
  { code: "UYU", decimals: 2 },
  { code: "BOB", decimals: 2 },
  { code: "PYG", decimals: 0 },
  { code: "DOP", decimals: 2 },
  { code: "GTQ", decimals: 2 },
  { code: "CRC", decimals: 2 },
  { code: "AUD", decimals: 2 },
  { code: "NZD", decimals: 2 },
];

export const CURRENCIES: readonly CurrencyDef[] = DEFS;

/** Just the codes, in picker order. */
export const CURRENCY_CODES: readonly string[] = DEFS.map((c) => c.code);

const BY_CODE = new Map(DEFS.map((c) => [c.code, c]));

/**
 * A currency the shop settings are allowed to store.
 *
 * `shop.currency` used to be `String(formData.get("currency") ?? "USD")` —
 * whatever arrived in the request. A hand-rolled POST could set it to anything,
 * and every price on that storefront would then be formatted by `Intl` against
 * a code it does not recognise, which throws and falls back to a bare number.
 */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && BY_CODE.has(value.toUpperCase());
}

/** The stored form of a code the caller cannot vouch for. */
export function toCurrencyCode(value: unknown, fallback = "USD"): string {
  return isCurrencyCode(value) ? String(value).toUpperCase() : fallback;
}

/**
 * How many decimal places this currency has. Two for anything unrecognised,
 * which is both the common case and the safe direction: treating a zero
 * decimal currency as two-decimal shows a price a hundred times too small,
 * while the reverse would charge a hundred times too much.
 */
export function currencyDecimals(code: string): number {
  return BY_CODE.get(String(code).toUpperCase())?.decimals ?? 2;
}

/** Minor units in one major unit: 1 for JPY, 100 for USD, 1000 for JOD. */
export function minorPerMajor(code: string): number {
  return 10 ** currencyDecimals(code);
}

/**
 * Stripe settles three-decimal currencies to two places and rejects an amount
 * that is not a multiple of ten. Rounding here rather than letting the API
 * refuse means a seller pricing at 9.999 JOD is charged 10.000 rather than
 * seeing a failed checkout they cannot diagnose.
 */
export function toStripeAmount(minor: number, code: string): number {
  return Math.round(minor / chargeStep(code)) * chargeStep(code);
}

/**
 * The smallest amount a card network can actually settle in this currency.
 *
 * One for almost everything. Ten for the three-decimal currencies — KWD, BHD,
 * JOD, OMR, TND — because card networks settle those to two places, so the
 * last digit of a price in fils is not chargeable at all. Stripe refuses an
 * amount that is not a multiple of ten rather than rounding it for you.
 *
 * Exported because rounding at the Stripe boundary alone is not enough: an
 * order whose total is not a multiple of ten cannot be charged as written, so
 * whatever Stripe is asked for necessarily differs from the invoice. Rounding
 * the order itself is what makes the two agree, and this is the number that
 * decides both.
 */
export function chargeStep(code: string): number {
  return currencyDecimals(code) === 3 ? 10 : 1;
}

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
function decimalSeparator(value: string): "." | "," | null {
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

  const separator = decimalSeparator(cleaned);
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

/** Human file size for download listings: 1536 → "1.5 KB". */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  // Bytes and kilobytes read better whole; megabytes deserve a decimal.
  return `${value >= 10 || exponent <= 1 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * How long a service takes: "45 min", "1 h 30 min". The units stay as the
 * symbols rather than words — this string is dropped into all 22 storefront
 * languages, and "hr" would read as English in every one of them.
 */
export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
