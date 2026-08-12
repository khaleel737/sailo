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
