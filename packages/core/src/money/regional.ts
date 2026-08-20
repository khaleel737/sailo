/**
 * Selling in the buyer's currency, at a price the seller typed.
 *
 * The whole feature is one idea: a row that has a price can carry a second,
 * third and fourth price beside it, one per currency, each a number a person
 * chose. Nothing here converts anything and nothing here reads a rate. See
 * `docs/specs/53-regional-pricing.md` for why — the short version is that a
 * rate which moves between the price shown and the order written is a price
 * the buyer never agreed to, and a seller-typed price is one that can be
 * rounded to read well, which is most of the conversion lift.
 *
 * Pure. No database, no headers, no `server-only` — the storefront, the
 * checkout, the admin form and the phone all ask the same questions of the
 * same shapes.
 */

import type { CurrencyPrice, CurrencyPrices } from "@sailo/db/schema";
import { isCurrencyCode } from "./codes";

/* -------------------------------------------------------------------------- */
/*  Which currencies, and who gets which                                       */
/* -------------------------------------------------------------------------- */

/**
 * The presentment currencies Sailo offers, and no others.
 *
 * The US, the EU and the UK — the market `RESHAPE-2026-08.md` names — plus
 * the two non-euro European neighbours the original nine forgot by their own
 * logic (a Swiss or Norwegian buyer doing euro arithmetic is the same buyer
 * as a Swedish one), and the four biggest cross-border markets beyond them.
 * Sailo takes seventy-one currencies as a *shop* currency; offering all of
 * them here would be seventy-one prices per product for a seller to keep in
 * step. Every entry is opt-in per shop, so length costs the unticked nothing.
 *
 * Order is the order the switcher shows.
 */
export const REGIONAL_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CHF",
  "NOK",
  "SEK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "CAD",
  "AUD",
  "JPY",
  "AED",
] as const;

export type RegionalCurrency = (typeof REGIONAL_CURRENCIES)[number];

export function isRegionalCurrency(value: unknown): value is RegionalCurrency {
  return (
    typeof value === "string" &&
    (REGIONAL_CURRENCIES as readonly string[]).includes(value.toUpperCase())
  );
}

/**
 * Country → the currency somebody there expects to be quoted.
 *
 * The euro area is written out rather than inferred from EU membership,
 * because the two are different sets and getting that backwards quotes a Pole
 * in euros. Sweden, Denmark, Poland, Czechia, Hungary and Romania are in the
 * EU and are not in the euro; every one of them is a market where a euro price
 * is still mental arithmetic.
 *
 * Anything absent maps to nothing, which means the shop's own currency —
 * exactly what a visitor gets today.
 */
const BY_COUNTRY: Record<string, RegionalCurrency> = {
  US: "USD",
  GB: "GBP",
  SE: "SEK",
  DK: "DKK",
  PL: "PLN",
  CZ: "CZK",
  HU: "HUF",
  RO: "RON",
  // The non-euro neighbours, and the majors beyond Europe. Liechtenstein
  // banks in Swiss francs; the franc covers both.
  CH: "CHF",
  LI: "CHF",
  NO: "NOK",
  CA: "CAD",
  AU: "AUD",
  JP: "JPY",
  AE: "AED",

  // The euro area, alphabetically. Twenty members as of 2026.
  AD: "EUR",
  AT: "EUR",
  BE: "EUR",
  CY: "EUR",
  DE: "EUR",
  EE: "EUR",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  GR: "EUR",
  HR: "EUR",
  IE: "EUR",
  IT: "EUR",
  LT: "EUR",
  LU: "EUR",
  LV: "EUR",
  MC: "EUR",
  MT: "EUR",
  NL: "EUR",
  PT: "EUR",
  SI: "EUR",
  SK: "EUR",
  SM: "EUR",
  VA: "EUR",
};

/** What a visitor in this country expects to be quoted, or null. */
export function currencyForCountry(country: unknown): RegionalCurrency | null {
  if (typeof country !== "string") return null;
  return BY_COUNTRY[country.trim().toUpperCase()] ?? null;
}

/**
 * The currency one visit is priced in.
 *
 * Order matters and each step is a refusal as much as a choice:
 *
 *   1. What the visitor picked, **only if the shop still offers it**. A cookie
 *      outlives a seller turning a currency off, and a stale one must not
 *      resurrect a price list that is no longer live.
 *   2. Where the request came from, through the map above. Never
 *      `Accept-Language`: a German speaker in London is a GBP buyer, and
 *      language is not location.
 *   3. The shop's own, which is what every visitor gets today.
 *
 * `live` is the shop's *live* currencies — the ones fully priced — not the
 * ones it has enabled. See `hasEveryPrice` below for the difference.
 */
export function resolveDisplayCurrency(input: {
  shopCurrency: string;
  /** Currencies this shop can actually quote right now. */
  live: readonly string[];
  /** The switcher cookie, if any. */
  chosen?: string | null;
  /** `x-vercel-ip-country`, if any. */
  country?: string | null;
}): string {
  const shop = input.shopCurrency.toUpperCase();
  const live = new Set(input.live.map((c) => c.toUpperCase()));

  const chosen = input.chosen?.trim().toUpperCase();
  if (chosen && (chosen === shop || live.has(chosen))) return chosen;

  const guessed = currencyForCountry(input.country);
  if (guessed && live.has(guessed)) return guessed;

  return shop;
}

/* -------------------------------------------------------------------------- */
/*  The stored shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The stored shape lives in `@sailo/db`, because four tables carry the column
 * and a type that four tables share should not be owned by whichever module
 * happens to read it. The *rules* are here: null secondary and absent secondary
 * mean the same thing, and blank is not zero anywhere in this file.
 */
export type { CurrencyPrice, CurrencyPrices };

/** A row that carries per-currency prices beside its own. */
export type RegionallyPriced = {
  currencyPrices?: CurrencyPrices | null;
};

/**
 * Whether a stored blob is shaped like one of these, checked at every read
 * boundary rather than trusted.
 *
 * A jsonb column has no schema, and this one is written by a form. Everything
 * downstream treats `price` as an integer number of minor units and puts it on
 * an invoice, so a string that slipped in would be concatenated into a total
 * rather than added to it.
 */
function readEntry(value: unknown): CurrencyPrice | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as { price?: unknown; secondary?: unknown };
  if (typeof entry.price !== "number" || !Number.isFinite(entry.price)) return null;
  if (entry.price < 0) return null;

  const secondary =
    typeof entry.secondary === "number" && Number.isFinite(entry.secondary)
      ? Math.max(0, Math.round(entry.secondary))
      : null;

  return { price: Math.round(entry.price), secondary };
}

/**
 * The row's price in this currency, or **null**.
 *
 * Null, and never the row's own price, and that is the single most important
 * line in this file. Falling back would render a dollar integer with a euro
 * sign in front of it — not a display bug but a wrong price on a page somebody
 * can buy from. Callers decide what to do with the null; none of them may
 * decide to guess.
 */
export function priceIn(
  row: RegionallyPriced,
  currency: string,
): CurrencyPrice | null {
  const prices = row.currencyPrices;
  if (!prices || typeof prices !== "object") return null;
  return readEntry(prices[currency.toUpperCase()]);
}

/** Whether this row can be quoted in this currency at all. */
export function hasPriceIn(row: RegionallyPriced, currency: string): boolean {
  return priceIn(row, currency) !== null;
}

/**
 * A row, re-read in another currency.
 *
 * The point of returning the row rather than the number: `variantPrice`,
 * `quote`, `computeTotals`, the buy box, the cart sheet and the Stripe line
 * items all read `priceCents` off a row, and none of them has to learn what a
 * currency is. One call at each load boundary, and every reader downstream is
 * unchanged.
 *
 * Four of them rather than one generic helper with a key argument, because the
 * second amount is a different column and a different rule in each case, and a
 * `keyof T` that stands for "compare-at, or free-over, or minimum subtotal"
 * hides exactly the part a reader needs to check.
 *
 * All four return `null` when there is no price in that currency, for the
 * reason `priceIn` does: falling back would quote a dollar integer with a euro
 * sign in front of it.
 */

/** Whether this currency is the shop's own, in which case nothing changes. */
function isOwn(currency: string, shopCurrency: string): boolean {
  return currency.toUpperCase() === shopCurrency.toUpperCase();
}

export function productAtCurrency<
  T extends RegionallyPriced & { priceCents: number; compareAtCents: number | null },
>(product: T, currency: string, shopCurrency: string): T | null {
  if (isOwn(currency, shopCurrency)) return product;
  const found = priceIn(product, currency);
  if (!found) return null;
  return { ...product, priceCents: found.price, compareAtCents: found.secondary ?? null };
}

export function variantAtCurrency<
  T extends RegionallyPriced & {
    priceCents: number | null;
    compareAtCents: number | null;
  },
>(variant: T, currency: string, shopCurrency: string): T | null {
  if (isOwn(currency, shopCurrency)) return variant;

  /*
   * A variant with no price of its own inherits the product's, in every
   * currency alike — so there is nothing to look up and nothing to refuse.
   * Reading the blob here regardless would make an inheriting variant demand
   * its own euro price, and take a whole catalogue out of euros for the sake
   * of rows that carry no price at all.
   */
  if (variant.priceCents === null) return variant;

  const found = priceIn(variant, currency);
  if (!found) return null;
  return { ...variant, priceCents: found.price, compareAtCents: found.secondary ?? null };
}

export function deliveryAtCurrency<
  T extends RegionallyPriced & { feeCents: number; freeOverCents: number | null },
>(method: T, currency: string, shopCurrency: string): T | null {
  if (isOwn(currency, shopCurrency)) return method;
  const found = priceIn(method, currency);
  if (!found) return null;
  return { ...method, feeCents: found.price, freeOverCents: found.secondary ?? null };
}

/**
 * A coupon in another currency.
 *
 * A **percentage** coupon is currency-free — 10% off is 10% off — so it is
 * returned untouched and needs no per-currency entry at all. Only a fixed
 * amount is a number in a currency, and one without an entry is refused rather
 * than converted: a `€5` code that quietly takes off five of whatever the
 * buyer is paying in is a discount nobody set.
 */
export function couponAtCurrency<
  T extends RegionallyPriced & {
    discountType: string;
    discountValue: number;
    minSubtotalCents: number;
  },
>(coupon: T, currency: string, shopCurrency: string): T | null {
  if (isOwn(currency, shopCurrency)) return coupon;
  if (coupon.discountType !== "fixed") {
    const found = priceIn(coupon, currency);
    /*
     * A percentage coupon may still carry a minimum subtotal, which is money.
     * With an entry, the minimum is that currency's; without one, a minimum of
     * zero is no minimum and needs nothing.
     */
    if (!found) {
      return coupon.minSubtotalCents === 0 ? coupon : null;
    }
    return { ...coupon, minSubtotalCents: found.secondary ?? 0 };
  }

  const found = priceIn(coupon, currency);
  if (!found) return null;
  return {
    ...coupon,
    discountValue: found.price,
    minSubtotalCents: found.secondary ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  Writing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What a seller typed, on its way into the column.
 *
 * Blank is not zero. An empty price field means "no price in this currency",
 * which is what makes the currency not live for this shop; `0` means free.
 * `moneyToCents` already keeps that distinction by answering null, and this
 * keeps it too — a currency whose entry is dropped is deliberately absent from
 * the object rather than present with a zero in it.
 */
export function buildCurrencyPrices(
  entries: Iterable<{
    currency: string;
    /** Minor units, already parsed. Null drops the currency. */
    priceCents: number | null;
    secondaryCents?: number | null;
  }>,
): CurrencyPrices {
  const out: CurrencyPrices = {};

  for (const entry of entries) {
    const code = entry.currency.toUpperCase();
    if (!isCurrencyCode(code) || !isRegionalCurrency(code)) continue;
    if (entry.priceCents === null || !Number.isFinite(entry.priceCents)) continue;
    if (entry.priceCents < 0) continue;

    out[code] = {
      price: Math.round(entry.priceCents),
      secondary:
        entry.secondaryCents === null || entry.secondaryCents === undefined
          ? null
          : Math.max(0, Math.round(entry.secondaryCents)),
    };
  }

  return out;
}

/**
 * The currencies a shop is allowed to store as its offering.
 *
 * Its own is never one of them — a shop already quotes its own currency, and a
 * duplicate entry would be a second place for the same price to be edited and
 * therefore a second place for it to be wrong.
 */
export function normalizeOfferedCurrencies(
  raw: unknown,
  shopCurrency: string,
): string[] {
  const shop = shopCurrency.toUpperCase();
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();

  for (const value of list) {
    if (typeof value !== "string") continue;
    const code = value.trim().toUpperCase();
    if (!isRegionalCurrency(code) || code === shop) continue;
    seen.add(code);
  }

  // Fixed order, so two sellers who ticked the same boxes store the same array
  // and a stored value never depends on the order a form serialised checkboxes.
  return REGIONAL_CURRENCIES.filter((code) => seen.has(code));
}
