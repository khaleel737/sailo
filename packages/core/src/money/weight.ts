import type { WeightBand } from "@sailo/db/schema";

/**
 * Pricing a parcel by what is in it — spec 51.
 *
 * `0019_shipping_zones` made per-country rates real; rates could not vary by
 * weight because nothing recorded weight. These are the two halves of closing
 * that: adding up what a basket weighs, and finding the band it falls in.
 *
 * WHY THERE IS NO CARRIER API HERE
 *
 * A band table reaches every carrier in every country, needs no credential at
 * rest, and cannot go down in the middle of a checkout. It is also the thing a
 * seller can reason about — they know what a 2 kg parcel costs because they
 * have posted one. A live rate lookup is a second network dependency on the
 * one path where a failure loses the sale.
 *
 * GRAMS, AS INTEGERS, FOR THE SAME REASON MONEY IS IN MINOR UNITS
 *
 * A float weight compared against a band boundary is a rounding argument with a
 * carrier: 2.3 kg lands either side of a 2,300 g boundary depending on how it
 * was stored and how it was summed. Integers cannot do that.
 */

/** The columns a weight decision reads. A trimmed literal satisfies it. */
export type WeighedLine = {
  /** Null means nobody has weighed it. See `basketWeightGrams`. */
  weightGrams?: number | null;
  quantity: number;
};

/**
 * What the whole basket weighs.
 *
 * **An unweighed line counts as nothing**, and that is a deliberate reading of
 * a genuinely ambiguous state rather than an oversight. A seller who switches a
 * rate to `by_weight` before weighing anything has every basket land in their
 * cheapest band — which is visible on their own screen, undercharges them
 * rather than the buyer, and is fixed by typing a number. The alternatives are
 * worse: refusing to quote would take the shop's shipping down the moment the
 * mode changed, and inventing a default weight would charge a buyer for a
 * number nobody typed.
 *
 * The seller's product list says how many products are unweighed, so this is a
 * state they can see rather than one they discover from a carrier invoice.
 */
export function basketWeightGrams(lines: readonly WeighedLine[]): number {
  return lines.reduce((sum, line) => {
    const each = line.weightGrams;
    if (typeof each !== "number" || !Number.isFinite(each) || each <= 0) return sum;
    return sum + Math.trunc(each) * Math.max(0, Math.trunc(line.quantity));
  }, 0);
}

/**
 * The bands a rate actually has, in the order they are read.
 *
 * Sorted here rather than trusted from the column, because the row is edited by
 * a seller dragging fields around and a table read out of order would charge
 * the 5 kg price for a 500 g parcel. Nonsense rows are dropped rather than
 * repaired: a band with no ceiling is not a band.
 */
export function usableBands(bands: readonly WeightBand[] | null | undefined): WeightBand[] {
  if (!Array.isArray(bands)) return [];
  return bands
    .filter(
      (band): band is WeightBand =>
        Boolean(band) &&
        typeof band.upToGrams === "number" &&
        Number.isFinite(band.upToGrams) &&
        band.upToGrams > 0 &&
        typeof band.priceCents === "number" &&
        Number.isFinite(band.priceCents) &&
        band.priceCents >= 0,
    )
    .map((band) => ({
      upToGrams: Math.trunc(band.upToGrams),
      priceCents: Math.trunc(band.priceCents),
    }))
    .sort((a, b) => a.upToGrams - b.upToGrams);
}

/**
 * The band a parcel of this weight falls in, or null if it is heavier than the
 * heaviest one.
 *
 * **Inclusive upper bounds**: a 500 g parcel takes the 500 g band, not the next
 * one up. Sellers write their tables that way — "up to 500 g" — and the
 * off-by-one in the other direction charges the higher price for the exact
 * weight the cheaper band names, which is the version a buyer notices.
 */
export function bandFor(
  bands: readonly WeightBand[] | null | undefined,
  grams: number,
): WeightBand | null {
  const usable = usableBands(bands);
  return usable.find((band) => grams <= band.upToGrams) ?? null;
}

/** What a rate charges, and null when this basket cannot use it at all. */
export type WeightedRate =
  | { ok: true; feeCents: number }
  /**
   * Heavier than the last band. The rate is withdrawn rather than charged at
   * the top price, because undercharging silently is the seller's money — and
   * `resolveDelivery` already has the vocabulary for a rate that cannot be had.
   */
  | { ok: false; reason: "over_max_weight"; maxGrams: number };

/**
 * What this rate costs for this basket.
 *
 * `flat` is every rate ever saved before spec 51 and is answered from
 * `feeCents` untouched — the free-over rule and the currency substitution both
 * still apply on top, in `deliveryFee`, exactly as they always have.
 *
 * A `by_weight` rate with **no bands** falls back to `feeCents` rather than
 * refusing. That is the half-configured state a seller passes through between
 * flipping the switch and typing the table, and taking their shipping down for
 * the minute in between would be a worse answer than charging the flat price
 * they had a moment ago.
 */
export function weightedRate(
  method: { rateMode?: string | null; weightBands?: WeightBand[] | null; feeCents: number },
  grams: number,
): WeightedRate {
  if (method.rateMode !== "by_weight") return { ok: true, feeCents: method.feeCents };

  const bands = usableBands(method.weightBands);
  if (bands.length === 0) return { ok: true, feeCents: method.feeCents };

  const band = bandFor(bands, grams);
  if (band) return { ok: true, feeCents: band.priceCents };

  return {
    ok: false,
    reason: "over_max_weight",
    // The heaviest band, so the seller's screen and the buyer's message can
    // both name the number rather than saying "too heavy".
    maxGrams: bands[bands.length - 1]?.upToGrams ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  What a person types, and what a person reads                               */
/* -------------------------------------------------------------------------- */

/**
 * Grams as a label, in the unit a reader of this weight would use.
 *
 * Not a stored second unit and not a picker — the column is grams and stays
 * grams. This is the label spec 51 says serves a seller who thinks in ounces
 * better than a second column would: one number, stored once, rendered in
 * whatever reads naturally.
 */
export function formatGrams(grams: number, locale = "en-US"): string {
  const value = grams >= 1000 ? grams / 1000 : grams;
  const unit = grams >= 1000 ? "kilogram" : "gram";
  try {
    return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
      style: "unit",
      unit,
      unitDisplay: "short",
      maximumFractionDigits: grams >= 1000 ? 2 : 0,
    }).format(value);
  } catch {
    return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${grams} g`;
  }
}
