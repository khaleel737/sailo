/**
 * The domain arithmetic behind `components/shared/chart.tsx`.
 *
 * Separate from the component because it is the part that can be wrong in a way
 * nobody sees. A bar drawn at the wrong height still looks like a chart, and the
 * bug this file exists to prevent shipped for months: revenue days that had gone
 * negative were clamped to a stub indistinguishable from a day with no sales.
 *
 * Positioning itself is `@visx/scale`'s job. What lives here is the decision of
 * *what the domain is* — which is a product question, not a maths one, and the
 * one that was wrong.
 */

export type Point = { day: string; value: number };

/** One measure across the same days as its siblings. */
export type Series = {
  key: string;
  label: string;
  values: number[];
  /** Bars read as discrete days; lines read as a trend across them. */
  shape: "bar" | "line";
  /**
   * Drawn below the zero line. Refunds are money leaving, and a chart that
   * stacks them on top of sales says the day was bigger than it was.
   */
  negative?: boolean;
};

/** The smallest bar a non-zero value may draw, so a real value is never invisible. */
export const MIN_BAR_PCT = 3;
/** What a zero day draws, so the column still reads as present. */
export const ZERO_BAR_PCT = 1.5;

/**
 * The vertical extent every series in a chart shares.
 *
 * One domain across all of them, never one per series: two series drawn to
 * their own maxima put a £5 refund at the same height as a £5,000 sale, which
 * is not a chart, it is two charts overlaid.
 */
export function chartDomain(series: Series[]): { min: number; max: number } {
  let max = 0;
  let min = 0;

  for (const s of series) {
    for (const raw of s.values) {
      // A negative series is *stored* positive — refunds are a positive amount
      // of money refunded — and flipped here, so callers never have to
      // remember to negate and the readout can print a plain figure.
      const value = s.negative ? -Math.abs(raw) : raw;
      if (value > max) max = value;
      if (value < min) min = value;
    }
  }

  /*
   * Zero is always inside the domain. Scaling to min..max instead would put the
   * smallest day on the floor whatever it was, so a week between £90 and £100
   * would look like a collapse, and a negative day would have no baseline to
   * hang from.
   */
  return { min, max };
}

/** Where a value sits, as a percentage down from the top of the plot. */
export function toPercent(value: number, domain: { min: number; max: number }) {
  // A flat series — all zero, or every day identical — would divide by nothing.
  const span = domain.max - domain.min || 1;
  return ((domain.max - value) / span) * 100;
}

/** Top and height of a bar, in percent, measured against the zero line. */
export function barRect(
  value: number,
  domain: { min: number; max: number },
): { top: number; height: number } {
  const span = domain.max - domain.min || 1;
  const zero = toPercent(0, domain);
  return {
    // Positive bars hang from their value down to zero; negative ones from
    // zero down to their value.
    top: value >= 0 ? toPercent(value, domain) : zero,
    height: Math.max(
      (Math.abs(value) / span) * 100,
      value === 0 ? ZERO_BAR_PCT : MIN_BAR_PCT,
    ),
  };
}

/** Which day to call out, what it was, and which measure it belonged to. */
export type Peak = { index: number; value: number; label: string };

/**
 * The day worth labelling: the largest single figure across every series, by
 * magnitude — so a catastrophic refund day is called out as readily as a
 * record sale.
 *
 * Returns the figure, not just where it is. An earlier version returned the
 * index alone, and the card ended up printing the word "Peak" above a date
 * with no number anywhere near it — a label with nothing to label.
 */
export function peak(series: Series[]): Peak | null {
  let best: Peak | null = null;

  for (const s of series) {
    for (let index = 0; index < s.values.length; index++) {
      const value = s.values[index] ?? 0;
      // A window of nothing has no peak; zero is not a high point.
      if (value === 0) continue;
      if (best === null || Math.abs(value) > Math.abs(best.value)) {
        best = { index, value, label: s.label };
      }
    }
  }

  return best;
}

/** True when any series carries a figure worth drawing. */
export function hasData(series: Series[]): boolean {
  return series.some((s) => s.values.some((v) => v !== 0));
}
