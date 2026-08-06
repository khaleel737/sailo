/**
 * The arithmetic behind `components/shared/chart.tsx`.
 *
 * Separate from the component because it is the part that can be wrong in a way
 * nobody sees. A bar drawn at the wrong height still looks like a chart, and the
 * bug this file exists to prevent shipped for months: revenue days that had gone
 * negative were clamped to a stub indistinguishable from a day with no sales.
 */

export type Point = { day: string; value: number };

export type Scale = {
  /** Top of the domain. Always at least zero. */
  hi: number;
  /** Bottom of the domain. Always at most zero. */
  lo: number;
  /** Height of the domain; never zero, so callers can divide by it. */
  span: number;
  /** Where the zero line sits, as a percentage down from the top. */
  zeroY: number;
  /** Vertical position of a value, as a percentage down from the top. */
  y: (value: number) => number;
  /** Horizontal centre of a column, as a percentage across. */
  x: (index: number) => number;
  /** Top and height of a bar, in percent, measured from the zero line. */
  bar: (value: number) => { top: number; height: number };
};

/** The smallest bar a non-zero value may draw, so a real value is never invisible. */
const MIN_BAR = 3;
/** What a zero day draws, so the column still reads as present. */
const ZERO_BAR = 1.5;

export function chartScale(data: Point[]): Scale {
  /*
   * The domain always includes zero. Scaling to min..max instead would put the
   * smallest day on the floor whatever it was, so a week between $90 and $100
   * would look like a collapse, and a negative day would have no baseline to
   * hang from.
   */
  const hi = data.reduce((m, d) => Math.max(m, d.value), 0);
  const lo = data.reduce((m, d) => Math.min(m, d.value), 0);
  // A flat series — all zero, or every day identical — would divide by nothing.
  const span = hi - lo || 1;
  const zeroY = (hi / span) * 100;

  const y = (value: number) => ((hi - value) / span) * 100;

  return {
    hi,
    lo,
    span,
    zeroY,
    y,
    // One point sits in the middle rather than pinned to the left edge.
    x: (index) => (data.length <= 1 ? 50 : (index / (data.length - 1)) * 100),
    bar: (value) => ({
      // Positive bars hang from their value down to zero; negative ones from
      // zero down to their value.
      top: value >= 0 ? y(value) : zeroY,
      height: Math.max(
        (Math.abs(value) / span) * 100,
        value === 0 ? ZERO_BAR : MIN_BAR,
      ),
    }),
  };
}

/**
 * The index of the day worth labelling — the largest by magnitude, so a
 * catastrophic refund day is called out as readily as a record sale.
 */
export function peakIndex(data: Point[]): number {
  return data.reduce(
    (best, d, i) =>
      Math.abs(d.value) > Math.abs(data[best]?.value ?? -Infinity) ? i : best,
    0,
  );
}
