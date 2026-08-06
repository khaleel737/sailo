import type { CursorSnapshot, Series } from "./types";

/**
 * Turning a pointer position into the day it is over.
 *
 * WHY THIS IS NOT A COMPONENT CONCERN
 * The first version gave every column its own transparent `<rect>` and let
 * `onPointerEnter` do the work. That reads fine and is wrong in two ways: it
 * scales the DOM with the window (a year's chart is 365 listeners), and it only
 * ever fires on *enter*, so a finger dragged across a phone screen updates
 * nothing — which is why that build needed a separate slider bolted underneath
 * to be usable on touch. One rect over the whole plot, plus this function,
 * removes both problems: a drag is continuous, and the reader scrubs the chart
 * itself rather than a proxy for it.
 *
 * Kept pure so the arithmetic can be tested without a browser, a pointer, or a
 * layout.
 */

/** Geometry of a band scale, as far as this needs to know. */
export type Bands = {
  /** Where the first band starts, in the same space as the pointer. */
  offset: number;
  /** Distance between band starts, including padding. */
  step: number;
  /** How many bands there are. */
  count: number;
};

/**
 * Which day a pointer at `x` is over.
 *
 * Clamped rather than nulled outside the bands: a pointer a few pixels past the
 * last column is still reaching for the last column, and blanking the readout
 * at the edge makes the chart feel like it has dead zones.
 */
export function indexAtPointer(x: number, bands: Bands): number | null {
  if (bands.count <= 0 || bands.step <= 0 || !Number.isFinite(x)) return null;

  const raw = Math.floor((x - bands.offset) / bands.step);
  return Math.min(Math.max(raw, 0), bands.count - 1);
}

/**
 * What to report for the day at `index`.
 *
 * Values are read straight from each series, never flipped: a refund is
 * reported as the amount refunded. Only the drawing cares which side of the
 * axis it belongs on — a readout that says "Refunds −$40" is telling the reader
 * about the chart rather than about their shop.
 */
export function snapshotAt(
  index: number,
  days: readonly string[],
  series: readonly Series[],
): CursorSnapshot | null {
  const day = days[index];
  if (day === undefined) return null;

  return {
    index,
    day,
    values: series.map((s) => ({
      key: s.key,
      label: s.label,
      value: s.values[index] ?? 0,
    })),
  };
}

/** The window total for a series, used when nothing is being pointed at. */
export function sumOf(series: Series | undefined): number {
  return (series?.values ?? []).reduce((total, value) => total + value, 0);
}
