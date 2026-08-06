import type { ChartTone } from "@/lib/chart-palette";

/** The shapes a series can be drawn as. */
export type ChartShape = "bar" | "line";

/** One measure across the same days as its siblings. */
export type Series = {
  key: string;
  label: string;
  values: number[];
  /** Bars read as discrete days; lines read as a trend across them. */
  shape: ChartShape;
  /**
   * Drawn below the zero line. Refunds are money leaving, and a chart that
   * stacks them on top of sales says the day was bigger than it was.
   */
  negative?: boolean;
  /**
   * Which step of the tone's lightness ramp to draw with. Defaults to the
   * series' position, which is usually right and was wrong exactly where it
   * mattered: on the revenue card, net is the headline figure but came third
   * in the array, so the number in the hero slot was drawn in the palest step
   * available and read as a wash behind the bars. Draw order and visual weight
   * are different decisions, so they get different knobs.
   */
  depth?: number;
  /**
   * Keep this series' shape when the reader switches the rest.
   *
   * Net revenue is a running summary, not a set of daily columns — as bars
   * beside the sales it summarises it reads as a competing measure. It stays a
   * line whatever the switch says.
   */
  fixedShape?: boolean;
};

/** The vertical extent a chart's series share. Always contains zero. */
export type Domain = { min: number; max: number };

/** What the reader is pointing at, and what it was worth. */
export type CursorSnapshot = {
  index: number;
  day: string;
  values: { key: string; label: string; value: number }[];
};

export type { ChartTone };
