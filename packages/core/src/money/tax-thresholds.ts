/**
 * Where a seller starts owing tax, as a checked-in table rather than a service.
 *
 * Sailo does not compute anybody's tax. Stripe Tax does that, on the seller's
 * own connected account, with the seller's registrations and the seller's
 * liability — spec 38 §"the line we do not cross". What this file is for is the
 * question that comes *before* a registration exists: a seller who has never
 * heard of economic nexus is selling into twelve US states and four EU
 * countries, and nothing anywhere tells them when that stops being fine.
 *
 * So these numbers exist to be counted *against*, and never to be presented as
 * an answer. A tile that reads "you must register in Germany" is a legal claim
 * this project is not qualified to make. What the screens built on this file say
 * is what was collected and where, next to a published figure and the date
 * somebody last looked at it — and then the seller draws the conclusion, which
 * is theirs to draw.
 *
 * THE DATE IS PART OF THE DATA
 *
 * Thresholds move. A stale number presented as advice is worse than no number,
 * because it is believed. `TAX_THRESHOLDS_REVIEWED_ON` travels to the screen
 * beside every figure taken from here, and the copy beside it says these are a
 * starting point a seller has to confirm.
 *
 * TWO DIFFERENT PROBLEMS LIVE IN HERE
 *
 * The market is the US and the EU and they do not work the same way.
 *
 *   - **US sales tax** is *per state*, and the threshold is economic nexus:
 *     cross it in Colorado and Colorado wants registering in, regardless of
 *     what happened in the other forty-four. So a US row is a region row and
 *     they are counted separately.
 *
 *   - **EU VAT** on distance selling is *one* threshold, €10,000, counted
 *     across every member state except the seller's own, combined. Cross it and
 *     the rate changes to the buyer's country everywhere at once, and the
 *     seller either registers in each country or files one OSS return. That is
 *     why the EU is a `group` here and not twenty-seven rows: twenty-seven rows
 *     of €3,000 each is a seller three times over the limit and a screen showing
 *     nothing but green.
 */

import { minorPerMajor } from "./codes";

/** The day the figures below were last checked against their sources. */
export const TAX_THRESHOLDS_REVIEWED_ON = "2026-08-19";

export type ThresholdPeriod = "calendar_year" | "rolling_12m";

export type TaxThreshold = {
  /** ISO 3166-1 alpha-2. `null` on the EU group row, which is not a country. */
  country: string | null;
  /** US state, Canadian province. Null when the whole country is one unit. */
  region: string | null;
  /**
   * The published figure in whole units of `currency`, or null where there is
   * no threshold at all — see `immediate`.
   */
  amount: number | null;
  currency: string;
  period: ThresholdPeriod;
  /**
   * Some US states trigger on a count of separate sales as well as on money,
   * and either one is enough. A seller with 210 orders of $12 is registered in
   * those states and nowhere near the dollar figure.
   */
  transactions?: number;
  /** No threshold: the obligation begins at the first sale into the place. */
  immediate?: boolean;
  /** Counted across a group of countries rather than this one alone. */
  group?: "eu";
  note?: string;
};

/**
 * The twenty-seven, for the group threshold and for nothing else.
 *
 * Not a general-purpose "is this the EU" list — `packages/payments` has its own
 * EEA set for a different question — but the membership that decides whether a
 * sale counts toward the €10,000. Kept here so a reader of this file can see
 * what "combined" means without opening another one.
 */
export const EU_MEMBER_STATES: readonly string[] = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR",
  "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
  "SE", "SI", "SK",
];

const EU = new Set(EU_MEMBER_STATES);

export function isEuMemberState(country: string | null | undefined): boolean {
  return typeof country === "string" && EU.has(country.toUpperCase());
}

/**
 * The EU's one combined figure.
 *
 * €10,000 of B2C sales into member states other than the seller's own, in a
 * calendar year. Below it a seller charges their home rate; above it the rate
 * is the buyer's, in every member state at once. There is no per-country
 * version of this number any more — the old per-country distance-selling
 * thresholds were replaced by this single one in 2021, and a table carrying
 * the old €35,000/€100,000 figures would be worse than carrying nothing.
 */
export const EU_DISTANCE_SELLING: TaxThreshold = {
  country: null,
  region: null,
  amount: 10_000,
  currency: "EUR",
  period: "calendar_year",
  group: "eu",
  note: "Combined B2C sales into EU member states other than your own.",
};

/**
 * US economic nexus, per state.
 *
 * Forty-five states and DC levy a sales tax; Alaska has no state-level tax and
 * appears here for its local jurisdictions' shared threshold, which is the one
 * a remote seller actually meets. Delaware, Montana, New Hampshire and Oregon
 * levy none and are absent — a seller shipping there crosses nothing.
 *
 * `transactions` is present only where the state still counts them. Several
 * dropped the count after 2019 precisely because it caught small sellers the
 * law was not aimed at, and a table that kept the repealed counts would report
 * nexus that does not exist.
 */
export const US_NEXUS: readonly TaxThreshold[] = (
  [
    ["AL", 250_000],
    ["AK", 100_000],
    ["AZ", 100_000],
    ["AR", 100_000, 200],
    ["CA", 500_000],
    ["CO", 100_000],
    ["CT", 100_000, 200],
    ["DC", 100_000, 200],
    ["FL", 100_000],
    ["GA", 100_000, 200],
    ["HI", 100_000, 200],
    ["IA", 100_000],
    ["ID", 100_000],
    ["IL", 100_000, 200],
    ["IN", 100_000],
    ["KS", 100_000],
    ["KY", 100_000, 200],
    ["LA", 100_000],
    ["MA", 100_000],
    ["MD", 100_000, 200],
    ["ME", 100_000],
    ["MI", 100_000, 200],
    ["MN", 100_000, 200],
    ["MO", 100_000],
    ["MS", 250_000],
    ["NC", 100_000],
    ["ND", 100_000],
    ["NE", 100_000, 200],
    ["NJ", 100_000, 200],
    ["NM", 100_000],
    ["NV", 100_000, 200],
    ["NY", 500_000, 100],
    ["OH", 100_000, 200],
    ["OK", 100_000],
    ["PA", 100_000],
    ["RI", 100_000, 200],
    ["SC", 100_000],
    ["SD", 100_000],
    ["TN", 100_000],
    ["TX", 500_000],
    ["UT", 100_000, 200],
    ["VA", 100_000, 200],
    ["VT", 100_000, 200],
    ["WA", 100_000],
    ["WI", 100_000],
    ["WV", 100_000, 200],
    ["WY", 100_000],
  ] as const
).map(([region, amount, transactions]) => ({
  country: "US",
  region,
  amount,
  currency: "USD",
  /*
   * "The current or previous calendar year" in most statutes, and a rolling
   * twelve months in a handful. The distinction changes when a seller crosses,
   * not whether — and getting it wrong in the safe direction means warning
   * slightly early, which is the direction this whole feature errs in.
   */
  period: "calendar_year" as const,
  ...(transactions ? { transactions } : {}),
}));

/**
 * Places with no threshold at all: the obligation starts at the first sale.
 *
 * The short list matters more than a long one would. These are the countries a
 * seller can be non-compliant in after a single €9 download, which is exactly
 * the case a threshold monitor cannot catch — there is nothing to approach.
 * `shops.tax_disable_immediate_obligation` exists so a seller can switch them
 * off wholesale rather than reading this list.
 */
export const IMMEDIATE_OBLIGATION: readonly TaxThreshold[] = (
  [
    ["PE", "Peru"],
    ["CL", "Chile"],
    ["CO", "Colombia"],
    ["MX", "Mexico"],
    ["TR", "Türkiye"],
    ["RS", "Serbia"],
    ["IS", "Iceland"],
    ["NO", "Norway"],
    ["ZA", "South Africa"],
    ["KR", "South Korea"],
    ["TW", "Taiwan"],
    ["IN", "India"],
    ["SA", "Saudi Arabia"],
    ["AE", "United Arab Emirates"],
    ["EG", "Egypt"],
    ["RU", "Russia"],
    ["UA", "Ukraine"],
  ] as const
).map(([country, name]) => ({
  country,
  region: null,
  amount: null,
  currency: "USD",
  period: "calendar_year" as const,
  immediate: true,
  note: `${name} expects registration from the first sale.`,
}));

/** Every row, for a lookup that does not care which family it came from. */
export const TAX_THRESHOLDS: readonly TaxThreshold[] = [
  EU_DISTANCE_SELLING,
  ...US_NEXUS,
  ...IMMEDIATE_OBLIGATION,
];

const BY_KEY = new Map<string, TaxThreshold>();
for (const row of TAX_THRESHOLDS) {
  if (row.country) BY_KEY.set(placeKey(row.country, row.region), row);
}

/** `US-CA`, `DE`. The one string every map in this feature is keyed by. */
export function placeKey(country: string, region?: string | null): string {
  const c = country.toUpperCase();
  return region ? `${c}-${region.toUpperCase()}` : c;
}

/**
 * The threshold for one place, or null when there is no published figure.
 *
 * A US sale falls back to the country row if the state is unknown — which it
 * often is, because `orders.region` is free text a buyer typed. There is no US
 * country row, so that falls through to null and the place is reported as
 * "not tracked" rather than as compliant, which is the honest answer.
 */
export function thresholdFor(
  country: string | null | undefined,
  region?: string | null,
): TaxThreshold | null {
  if (!country) return null;
  return (
    BY_KEY.get(placeKey(country, region)) ?? BY_KEY.get(placeKey(country)) ?? null
  );
}

/* -------------------------------------------------------------------------- */
/* Comparing a number in one currency to a threshold in another                */
/* -------------------------------------------------------------------------- */

/**
 * Indicative rates, carried for one job: putting a shop's revenue and a
 * published threshold on the same axis long enough to draw a bar.
 *
 * Deliberately static, deliberately dated, and deliberately never stored. Spec
 * 38: *"Revenue is counted in the order's own currency, and a threshold is in
 * the jurisdiction's. Store both, convert at display time only, and show the
 * rate and date used. A stored converted number is wrong the next day and
 * unauditable."* Everything written to `tax_revenue_daily` is the minor units
 * the order actually carried; this is applied on the way to a screen and
 * nowhere else.
 *
 * A shop trading in the threshold's own currency — a US shop in USD, an EU shop
 * in EUR, which between them is most of the market — never touches this at all.
 */
export const INDICATIVE_RATES_REVIEWED_ON = "2026-08-19";

/** Units of each currency to one euro. */
const PER_EUR: Record<string, number> = {
  EUR: 1,
  USD: 1.08,
  GBP: 0.84,
  CHF: 0.94,
  SEK: 11.3,
  NOK: 11.7,
  DKK: 7.46,
  PLN: 4.28,
  CZK: 25.1,
  HUF: 395,
  RON: 4.97,
  BGN: 1.96,
  CAD: 1.48,
  AUD: 1.63,
  NZD: 1.78,
  JPY: 165,
  AED: 3.97,
  SAR: 4.05,
  ZAR: 19.8,
  INR: 91,
  TRY: 38,
  BRL: 5.9,
  MXN: 19.9,
  SGD: 1.45,
  HKD: 8.4,
};

/**
 * How many of `to` one of `from` buys, or null when either is unlisted.
 *
 * Null rather than 1. A missing rate is not parity, and a screen that quietly
 * assumed it would compare 400,000 JPY against a $100,000 threshold and report
 * four times over.
 */
export function indicativeRate(from: string, to: string): number | null {
  const a = PER_EUR[from.toUpperCase()];
  const b = PER_EUR[to.toUpperCase()];
  if (!a || !b) return null;
  return b / a;
}

/** Minor units in `from` to minor units in `to`, or null with no rate. */
export function convertMinor(
  minor: number,
  from: string,
  to: string,
): number | null {
  if (from.toUpperCase() === to.toUpperCase()) return minor;
  const rate = indicativeRate(from, to);
  if (rate === null) return null;

  // Through major units, because the two sides can have different exponents:
  // 1000 minor JOD is 1 dinar and 1000 minor USD is ten dollars.
  const major = minor / minorPerMajor(from);
  return Math.round(major * rate * minorPerMajor(to));
}

/** The threshold as minor units of `currency`, or null when uncomparable. */
export function thresholdMinorIn(
  threshold: TaxThreshold,
  currency: string,
): number | null {
  if (threshold.amount === null) return null;
  const own = threshold.amount * minorPerMajor(threshold.currency);
  return convertMinor(own, threshold.currency, currency);
}

/* -------------------------------------------------------------------------- */
/* The arithmetic                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What one place contributed, already summed from stored minor units.
 *
 * `netB2cMinor` is the only figure a threshold ever sees. Selling to a
 * registered company in another country is generally not a taxable supply the
 * seller collects on — the buyer accounts for it — so those sales do not move
 * a threshold, which is why `tax_revenue_daily` splits B2B into its own column
 * rather than leaving it to be filtered out by whoever remembers.
 */
export type PlaceRevenue = {
  country: string;
  region: string | null;
  currency: string;
  netB2cMinor: number;
  netB2bMinor: number;
  taxMinor: number;
  orderCount: number;
};

export type WatchState =
  /** No published figure for this place. Reported, never counted as safe. */
  | "untracked"
  /** A published figure exists but the currencies cannot be compared. */
  | "uncomparable"
  /** Obligation from the first sale — nothing to approach. */
  | "immediate"
  | "under"
  /** Past 70% of the figure. */
  | "approaching"
  /** Past 90%. */
  | "near"
  | "crossed";

export type ThresholdWatch = {
  /** `US-CA`, `DE`, or `EU` for the group row. */
  key: string;
  scope: "region" | "country" | "eu";
  country: string | null;
  region: string | null;
  threshold: TaxThreshold | null;
  currency: string;
  netB2cMinor: number;
  netB2bMinor: number;
  taxMinor: number;
  orderCount: number;
  /** The published figure in `currency`, or null when it could not be moved. */
  thresholdMinor: number | null;
  /** Never negative: a crossed threshold has nothing remaining. */
  remainingMinor: number | null;
  /** 0–1 and beyond, or null when there is nothing to divide by. */
  ratio: number | null;
  /** True where a count of sales, not the money, is what crosses it. */
  crossedOnTransactions: boolean;
  state: WatchState;
  /** The seller told us they are already registered here. */
  registered: boolean;
};

export type WatchInput = {
  rows: readonly PlaceRevenue[];
  /** Where the seller's own business is. Its own sales cross nothing. */
  homeCountry: string | null;
  /** `US-CA`, `DE` — from `tax_jurisdictions`. */
  registeredKeys: readonly string[];
  /**
   * One OSS return covers every member state, so the group threshold stops
   * being the thing to watch — the seller is already charging destination
   * rates everywhere. The row stays visible and is marked registered.
   */
  ossRegistered: boolean;
};

/** 70% and 90%, the two rungs the alert mails are sent on. */
export const APPROACHING_RATIO = 0.7;
export const NEAR_RATIO = 0.9;

/**
 * Every place the shop sold into, against whatever figure applies to it.
 *
 * Grouping is the whole of the work. A US sale is grouped by state because
 * nexus is a state fact; an EU sale is *removed* from its country and added to
 * one combined row because the €10,000 is a single figure across all of them;
 * everything else is grouped by country. Getting the grouping wrong is not a
 * rounding error — it is the difference between one seller who is over the
 * limit and twenty-seven who look fine.
 */
export function watchJurisdictions(input: WatchInput): ThresholdWatch[] {
  const home = input.homeCountry?.toUpperCase() ?? null;
  const registered = new Set(input.registeredKeys.map((k) => k.toUpperCase()));

  const byKey = new Map<string, ThresholdWatch>();

  const blank = (
    key: string,
    scope: ThresholdWatch["scope"],
    country: string | null,
    region: string | null,
    currency: string,
    threshold: TaxThreshold | null,
  ): ThresholdWatch => ({
    key,
    scope,
    country,
    region,
    threshold,
    currency,
    netB2cMinor: 0,
    netB2bMinor: 0,
    taxMinor: 0,
    orderCount: 0,
    thresholdMinor: null,
    remainingMinor: null,
    ratio: null,
    crossedOnTransactions: false,
    state: "untracked",
    registered: false,
  });

  for (const row of input.rows) {
    const country = row.country.toUpperCase();
    const region = row.region?.toUpperCase() || null;

    /*
     * A sale at home is not distance selling and never was. Counting it toward
     * the €10,000 would have a German seller warned about Germany, where they
     * are already registered by definition — and it would consume the whole
     * allowance with domestic revenue, so the countries the threshold is
     * actually about would never show anything.
     */
    const isEuGroup = isEuMemberState(country) && country !== home;

    const key = isEuGroup ? "EU" : placeKey(country, region);
    const scope: ThresholdWatch["scope"] = isEuGroup
      ? "eu"
      : region
        ? "region"
        : "country";

    let entry = byKey.get(key);
    if (!entry) {
      entry = blank(
        key,
        scope,
        isEuGroup ? null : country,
        isEuGroup ? null : region,
        row.currency,
        isEuGroup ? EU_DISTANCE_SELLING : thresholdFor(country, region),
      );
      byKey.set(key, entry);
    }

    /*
     * Mixed currencies inside one place, which happens to a shop that changed
     * its own currency partway through a year. Summing them as if they were the
     * same number is the one thing that must not happen, so anything that is
     * not the row's first currency is converted at display time — and if it
     * cannot be, the place is marked uncomparable rather than silently short.
     */
    const net = same(row.currency, entry.currency)
      ? row.netB2cMinor
      : convertMinor(row.netB2cMinor, row.currency, entry.currency);
    const b2b = same(row.currency, entry.currency)
      ? row.netB2bMinor
      : convertMinor(row.netB2bMinor, row.currency, entry.currency);
    const tax = same(row.currency, entry.currency)
      ? row.taxMinor
      : convertMinor(row.taxMinor, row.currency, entry.currency);

    if (net === null || b2b === null || tax === null) {
      entry.state = "uncomparable";
    } else {
      entry.netB2cMinor += net;
      entry.netB2bMinor += b2b;
      entry.taxMinor += tax;
    }
    entry.orderCount += row.orderCount;
  }

  for (const entry of byKey.values()) {
    entry.registered =
      (entry.scope === "eu" && input.ossRegistered) || registered.has(entry.key);
    settle(entry);
  }

  /*
   * Crossed first, then by how close, then by name. A seller opening this tab
   * wants the two rows that need a decision, and sorting alphabetically buries
   * them under thirty that do not.
   */
  const order: Record<WatchState, number> = {
    crossed: 0,
    immediate: 1,
    near: 2,
    approaching: 3,
    uncomparable: 4,
    under: 5,
    untracked: 6,
  };
  return [...byKey.values()].sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      (b.ratio ?? 0) - (a.ratio ?? 0) ||
      a.key.localeCompare(b.key),
  );
}

function same(a: string, b: string) {
  return a.toUpperCase() === b.toUpperCase();
}

/** Fills in the derived half of one row: the figure, the gap, the state. */
function settle(entry: ThresholdWatch): void {
  if (entry.state === "uncomparable") return;

  const threshold = entry.threshold;
  if (!threshold) {
    entry.state = "untracked";
    return;
  }

  if (threshold.immediate) {
    entry.state = "immediate";
    return;
  }

  const limit = thresholdMinorIn(threshold, entry.currency);
  if (limit === null || limit <= 0) {
    entry.state = "uncomparable";
    return;
  }

  entry.thresholdMinor = limit;
  entry.ratio = entry.netB2cMinor / limit;
  entry.remainingMinor = Math.max(0, limit - entry.netB2cMinor);

  /*
   * Either figure crosses it. A state that counts sales is crossed by the count
   * whatever the money says, and a seller at 210 orders of $12 who saw a green
   * bar reading "2% of $100,000" would be looking at a screen that is telling
   * them the opposite of the truth.
   */
  entry.crossedOnTransactions =
    threshold.transactions !== undefined &&
    entry.orderCount >= threshold.transactions;

  if (entry.crossedOnTransactions || entry.ratio >= 1) entry.state = "crossed";
  else if (entry.ratio >= NEAR_RATIO) entry.state = "near";
  else if (entry.ratio >= APPROACHING_RATIO) entry.state = "approaching";
  else entry.state = "under";
}

/**
 * The rung an alert is sent at, or null for one that isn't worth a mail.
 *
 * Two rungs and no more, each sent once — `tax_country_rules` carries the claim.
 * A third would be noise, and a percentage that mails on every tick is a
 * percentage sellers filter to a folder.
 */
export function alertRung(state: WatchState): "70" | "90" | null {
  if (state === "approaching") return "70";
  if (state === "near" || state === "crossed") return "90";
  return null;
}
