/**
 * Countries, as codes rather than as whatever somebody typed.
 *
 * Two things needed this and had been solving it separately: the analytics
 * dashboard, which gets alpha-2 codes from GeoIP and has always rendered them
 * properly, and the checkout, which asked for a country as free text and got
 * "Hrvatska", "HR", "croatia" and blank — unfilterable, and impossible to
 * check a shipping zone against. This is the one list both read.
 *
 * Names are never stored here. `Intl.DisplayNames` already ships every country
 * translated into every locale the runtime supports, so a dropdown reads
 * "Njemačka" on a Croatian storefront and "Germany" on an English one without
 * this file carrying 250 names × 35 languages. Only the codes are ours.
 */

/**
 * ISO 3166-1 alpha-2, officially assigned.
 *
 * Minus the six with no resident population and no postal service of their
 * own — Antarctica, Bouvet Island, South Georgia, Heard & McDonald, the French
 * Southern Territories and the US Minor Outlying Islands. They are real codes
 * and they are also pure noise in a list whose entire purpose is "where will
 * you post this", where every extra row is one more thing to scroll past.
 *
 * Plus `XK`, which is not officially assigned — Kosovo has no ISO code, and
 * `XK` is the user-assigned one that CLDR, the EU and every carrier settled
 * on. A seller in this product's home region ships there; leaving it out to be
 * technically correct would mean they could not say so.
 */
export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AR", "AS", "AT", "AU", "AW",
  "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM",
  "BN", "BO", "BQ", "BR", "BS", "BT", "BW", "BY", "BZ", "CA", "CC", "CD", "CF",
  "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX",
  "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH", "ER",
  "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GT", "GU", "GW", "GY",
  "HK", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR",
  "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP",
  "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU",
  "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN",
  "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA",
  "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH",
  "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY",
  "SZ", "TC", "TD", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT",
  "TV", "TW", "TZ", "UA", "UG", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

/** Membership is asked once per country per keystroke in the picker's search. */
const CODES = new Set<string>(COUNTRY_CODES);

export function isCountryCode(value: string): value is CountryCode {
  return CODES.has(value);
}

/**
 * What the buyer chose, as a code we can compare — or null.
 *
 * Null is not a failure to be reported. A country that isn't on the list is a
 * legacy free-text value ("Hrvatska") or a blank field, and both are perfectly
 * ordinary; what they are not is something a shipping zone can be checked
 * against, which is the caller's problem and not this function's.
 */
export function normalizeCountry(value: string | null | undefined): CountryCode | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return isCountryCode(code) ? code : null;
}

/**
 * Cached per locale. `Intl.DisplayNames` is expensive to construct and this
 * runs once per row, but a single shared instance would pin every later caller
 * to whichever locale happened to ask first.
 */
const countryNames = new Map<string, Intl.DisplayNames>();

/** "DE" → "Germany". Falls back to the code when the runtime doesn't know it. */
export function countryName(code: string | null, locale = "en"): string {
  if (!code) return "Unknown";
  try {
    let names = countryNames.get(locale);
    if (!names) {
      // `fallback: "code"` returns "ZZ" for an unrecognised code. The default
      // returns the literal string "Unknown Region", which a seller reads as a
      // bug in the dashboard rather than as a country we couldn't place.
      names = new Intl.DisplayNames([locale], {
        type: "region",
        fallback: "code",
      });
      countryNames.set(locale, names);
    }
    return names.of(code.toUpperCase()) ?? code;
  } catch {
    /*
     * `.of()` throws a RangeError for anything that isn't shaped like a region
     * subtag, which is exactly what a free-text country from an older order
     * looks like. Handing the value back unchanged is right: "Hrvatska" is
     * what the buyer wrote and is still the most accurate thing we have.
     */
    return code;
  }
}

/** ISO 3166-1 alpha-2 → the flag emoji, by offsetting into the indicator block. */
export function countryFlag(code: string | null): string {
  if (!code || code.length !== 2 || !/^[a-z]{2}$/i.test(code)) return "🌍";
  /*
   * ZZ is CLDR's code for "Unknown Region" and arrives from GeoIP whenever an
   * address cannot be placed. It is two letters, so it would otherwise build a
   * flag for a country that does not exist — which renders as two letter-boxes
   * beside a name that already reads "Unknown Region".
   */
  if (code.toUpperCase() === "ZZ") return "🌍";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

/** Every country there is, sorted by its name in the reader's language. */
export function countriesByName(locale = "en"): { code: CountryCode; name: string }[] {
  const collator = new Intl.Collator(locale);
  /*
   * `.sort()` rather than `.toSorted()`, and it is not a style choice: Hermes
   * does not implement the ES2023 change-by-copy array methods, so `toSorted`
   * is `undefined` on the phone and this threw a render error on the screen
   * that picks a country. Node and every browser we target have it, which is
   * why it survived typecheck, jest and the web build — the only thing that
   * catches it is running the app.
   *
   * Mutating is safe here because `.map()` above just built the array; there
   * is no caller's copy to disturb. That is the condition for this swap, and
   * it holds at all five sites that had to make it — check it before making a
   * sixth, because on an array a caller still holds the two are not the same
   * function.
   *
   * What stops a sixth is `@sailo/config/tsconfig.hermes.json`, which this
   * package extends: it lowers `lib` to es2022, so `toSorted` is not merely
   * discouraged here, it does not typecheck.
   */
  return COUNTRY_CODES.map((code) => ({
    code,
    name: countryName(code, locale),
  })).sort((a, b) => collator.compare(a.name, b.name));
}

/* -------------------------------------------------------------------------- */
/*  Presets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Ways to fill the box, not things the database knows.
 *
 * A zone is always stored as its member codes. Storing "EU" instead would mean
 * that the day a country joins or leaves, every rate ever saved silently
 * changes what it promised — including the ones on orders already placed. So a
 * preset is a button that writes 27 codes and is then forgotten.
 */
export const EU: readonly CountryCode[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE",
];

/** The single market: the EU plus the three EFTA states inside it. */
export const EEA: readonly CountryCode[] = [...EU, "IS", "LI", "NO"];

/**
 * The continent, which is a bigger and vaguer thing than either — and the one
 * a seller usually means by "I post around Europe". Switzerland and the UK are
 * in it and in neither list above.
 */
export const EUROPE: readonly CountryCode[] = [
  "AD", "AL", "AT", "AX", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK",
  "EE", "ES", "FI", "FO", "FR", "GB", "GG", "GI", "GR", "HR", "HU", "IE", "IM",
  "IS", "IT", "JE", "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL",
  "NO", "PL", "PT", "RO", "RS", "RU", "SE", "SI", "SJ", "SK", "SM", "UA", "VA",
  "XK",
];

export const NORTH_AMERICA: readonly CountryCode[] = ["US", "CA", "MX"];

/**
 * `key` is what the admin dictionary is keyed on — the labels are translated
 * beside the rest of the delivery screen rather than living here, because this
 * module is imported by the storefront too and has no business holding
 * seller-facing copy.
 */
export const COUNTRY_GROUPS = [
  { key: "eu", codes: EU },
  { key: "eea", codes: EEA },
  { key: "europe", codes: EUROPE },
  { key: "northAmerica", codes: NORTH_AMERICA },
] as const;

export type CountryGroupKey = (typeof COUNTRY_GROUPS)[number]["key"];

/* -------------------------------------------------------------------------- */
/*  Guessing where someone is                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The country a time zone belongs to, out of a list worth considering.
 *
 * Built from the runtime's own CLDR data rather than from a table shipped in
 * the bundle. `Intl.Locale.prototype.getTimeZones()` answers the reverse
 * question — "which zones does Germany use" — so asking it once per candidate
 * and inverting the result gives the mapping for free, stays correct when the
 * IANA database changes underneath us, and adds nothing to what a buyer
 * downloads. A hand-maintained list of four hundred zones would have done all
 * three worse.
 *
 * `candidates` is the point of the signature. A shop that posts only within
 * Croatia has three countries to check, not two hundred and forty-four, and
 * the caller already knows which. Passing the offered list keeps the work
 * proportional to the question and means the guess can never land on a country
 * the buyer would not have been allowed to pick anyway.
 *
 * Returns null rather than a fallback whenever it cannot be sure — an
 * unsupported runtime, a zone CLDR doesn't place, or a zone belonging to a
 * country that isn't on offer. A wrong guess here silently filters the
 * delivery rates a buyer is shown, so "no guess" is the safe answer and an
 * empty dropdown is the honest one.
 */
export function countryFromTimeZone(
  timeZone: string | null | undefined,
  candidates: readonly string[] = COUNTRY_CODES,
): CountryCode | null {
  if (!timeZone) return null;

  for (const code of candidates) {
    if (!isCountryCode(code)) continue;
    for (const zone of zonesFor(code)) {
      if (zone === timeZone) return code;
    }
  }

  return null;
}

/**
 * Cached because the caller may ask about the same country twice and because
 * `Intl.Locale` is not cheap to construct — a shop posting everywhere asks
 * this two hundred and forty-four times in one pass.
 */
const zonesByCountry = new Map<string, readonly string[]>();

function zonesFor(code: CountryCode): readonly string[] {
  const cached = zonesByCountry.get(code);
  if (cached) return cached;

  let zones: readonly string[] = [];
  try {
    /*
     * `getTimeZones()` is the method; older engines exposed the same data as a
     * `timeZones` getter. Both are read, and anything that has neither falls
     * through to an empty list rather than throwing — a buyer on an old
     * browser should get an unfilled dropdown, not a broken checkout.
     */
    const locale = new Intl.Locale(`und-${code}`) as Intl.Locale & {
      getTimeZones?: () => string[];
      timeZones?: string[];
    };
    zones = locale.getTimeZones?.() ?? locale.timeZones ?? [];
  } catch {
    zones = [];
  }

  zonesByCountry.set(code, zones);
  return zones;
}

/** The zone this device is set to, or null where there is no `Intl` to ask. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Where a seller can hold a Stripe account                                   */
/* -------------------------------------------------------------------------- */

/**
 * The countries Stripe will open a connected account in.
 *
 * A shorter list than `COUNTRY_CODES` and a different question. That one asks
 * "where will you post this" and is about the buyer; this asks "where is your
 * business", and the answer has to be a country Stripe actually operates in.
 * A seller in a country that isn't here cannot take card payments through
 * Sailo at all, however much of the rest of the product works for them.
 *
 * It matters more than a list normally would because **Stripe fixes a
 * connected account's country at creation and will not change it afterwards**.
 * There is no edit: a seller who onboards under the wrong country has to have
 * the account deleted and start again, losing whatever onboarding they had
 * done. That is why `stripeCountry` is asked before the account exists rather
 * than inferred after it, and why the picker offers only this list.
 *
 * The source is https://stripe.com/global — the merchant-availability page —
 * and deliberately **not** `GET /v1/country_specs`, which is where the first
 * version of this list came from. That endpoint answers a different question:
 * it also carries every country Stripe can merely *send a payout to*
 * (cross-border recipients), so it offered a seller in Jordan a country that
 * account creation then refused. A country spec existing is not the same as
 * Stripe opening accounts there.
 *
 * Two tiers inside the list are worth knowing when an onboarding fails
 * anyway: CI, GH, KE, NG and ZA are "extended network" countries, and IN and
 * ID are listed as preview. They are offered because Stripe offers them, and
 * they are the first suspects when a seller from one of them gets a refusal.
 * `check:connect` verifies every code here is one Stripe recognises; new
 * countries arrive by reading the page above, not the API.
 */
export const STRIPE_ACCOUNT_COUNTRIES = [
  "AE", "AT", "AU", "BE", "BG", "BR", "CA", "CH", "CI", "CY", "CZ", "DE",
  "DK", "EE", "ES", "FI", "FR", "GB", "GH", "GI", "GR", "HK", "HR", "HU",
  "ID", "IE", "IN", "IT", "JP", "KE", "LI", "LT", "LU", "LV", "MT", "MX",
  "MY", "NG", "NL", "NO", "NZ", "PL", "PT", "RO", "SE", "SG", "SI", "SK",
  "TH", "US", "ZA",
] as const satisfies readonly CountryCode[];

export type StripeAccountCountry = (typeof STRIPE_ACCOUNT_COUNTRIES)[number];

const STRIPE_CODES = new Set<string>(STRIPE_ACCOUNT_COUNTRIES);

export function isStripeAccountCountry(
  value: string | null | undefined,
): value is StripeAccountCountry {
  return Boolean(value) && STRIPE_CODES.has(value as string);
}

/**
 * The same list, named and sorted for a picker.
 *
 * Sorted by the *translated* name, so a Croatian seller sees Njemačka filed
 * under N. Sorting the codes instead would be stable and useless — nobody
 * scans a dropdown looking for "DE".
 */
export function stripeAccountCountriesByName(
  locale = "en",
): { code: StripeAccountCountry; name: string }[] {
  const collator = new Intl.Collator(locale);
  // `.sort()` rather than `.toSorted()` for the Hermes reason above; `.map()`
  // just built this array, so there is no caller's copy to disturb.
  return STRIPE_ACCOUNT_COUNTRIES.map((code) => ({
    code,
    name: countryName(code, locale),
  })).sort((a, b) => collator.compare(a.name, b.name));
}
