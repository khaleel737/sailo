import type { ChartTone } from "@/lib/chart-palette";

/**
 * How a chart draws its measures. One shape for the whole chart, never one per
 * series.
 *
 * The first version put `shape` on each series, which let a revenue card draw
 * sales as bars and net as a line at the same time. Two shapes in one frame is
 * two charts overlaid: the eye reads the line as a different *kind* of thing
 * rather than as a summary of the bars beneath it, and there is no honest way
 * to say which one the axis belongs to. The reader picks a shape and every
 * plotted measure honours it.
 */
export type ChartShape = "bar" | "line";

/** One measure across the same days as its siblings. */
export type Series = {
  key: string;
  label: string;
  values: number[];
  /**
   * Drawn below the zero line. Refunds are money leaving, and a chart that
   * stacks them on top of sales says the day was bigger than it was.
   */
  negative?: boolean;
  /**
   * Which step of the tone's lightness ramp to draw with. Defaults to the
   * series' position, which is usually right and was wrong exactly where it
   * mattered: net is the headline figure but came third in the array, so the
   * number in the hero slot was drawn in the palest step available. Draw order
   * and visual weight are different decisions, so they get different knobs.
   */
  depth?: number;
  /**
   * Reported but never drawn.
   *
   * Net revenue is sales minus refunds — it is already on the card twice over,
   * once per bar. Plotting it as a third measure competes with the two it is
   * derived from and stretches nothing about the axis, so it lives in the
   * headline and the readout where a figure belongs.
   */
  readoutOnly?: boolean;
};

/** The vertical extent a chart's series share. Always contains zero. */
export type Domain = { min: number; max: number };

/** What the reader is pointing at, and what it was worth. */
export type CursorSnapshot = {
  index: number;
  day: string;
  values: { key: string; label: string; value: number }[];
};

/** The series a chart actually draws — everything not reported-only. */
export function plotted(series: readonly Series[]): Series[] {
  return series.filter((s) => !s.readoutOnly);
}

export type { ChartTone };
