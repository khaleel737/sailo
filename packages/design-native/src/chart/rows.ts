import { chartColour, plotted, type ChartTone, type Series } from "@sailo/core/chart";

/**
 * The bridge between how a screen describes a chart and what the renderer eats.
 *
 * A screen hands over `days` and a list of `Series`, exactly as it does on the
 * web. `CartesianChart` wants a flat array of row objects and a list of keys
 * into them, and it is generic over that row's shape — which is the whole
 * problem this file solves.
 *
 * WHY THE SLOTS ARE FIXED AND NUMBERED
 *
 * The obvious mapping is one column per series, keyed by the series' own key.
 * That types as `Record<string, number>`, and `Record<string, number>` defeats
 * every generic in `victory-native`: `yKeys` stops being checkable, the press
 * state's `y` map stops matching the chart's, and the whole thing ends up held
 * together by casts that would go on lying after somebody renamed a series.
 *
 * So the slots are fixed: `s0`, `s1`, `s2`, in draw order. Three, and the
 * number is not arbitrary — `@sailo/core/chart/palette` caps a chart at three
 * series and says why: each step is the same hue with lightness raised, and a
 * fourth step lands inside the just-noticeable difference of the third at chart
 * line widths. The palette has been refusing to give out a fourth colour since
 * it was written. This makes that refusal a type rather than a comment, and
 * `MAX_PLOTTED` below is the same number said once.
 *
 * A caller that passes four plotted series gets three drawn and an error in
 * development, rather than a fourth series silently painted in the third's
 * colour — which is the failure the palette's own note is trying to prevent.
 */

/** How many series may be *drawn*. Reported-only series do not count. */
export const MAX_PLOTTED = 3;

/**
 * One day, as `CartesianChart` wants it.
 *
 * `x` is the day's index rather than its date. The scale underneath is linear,
 * so a date string would have to be mapped to a number somewhere regardless,
 * and doing it here means the axis formatter is handed an index it can look a
 * label up with — which is what makes a locale change re-label the axis without
 * rebuilding the data.
 *
 * Every slot is present on every row, `0` where a series does not reach. An
 * absent key would make the column ragged and `CartesianChart` would drop the
 * day rather than draw it at nothing, which is the bug `hasData` and the
 * zero-bar floor exist to prevent at the other end.
 */
export type ChartRow = {
  x: number;
  s0: number;
  s1: number;
  s2: number;
};

/** One of the three drawable slots. */
export type Slot = "s0" | "s1" | "s2";

/**
 * The slot names, in draw order.
 *
 * Deliberately **not** `as const`. `CartesianChart` takes `yKeys` as a mutable
 * array, so a readonly tuple has to be spread at the call site — which
 * allocates a new array on every render and hands the chart a prop that is
 * never referentially equal to the last one, defeating its own memoisation
 * during a scrub. Typed rather than inferred, so the union is still exact.
 */
export const SLOTS: Slot[] = ["s0", "s1", "s2"];

/**
 * What a slot holds while the reader is pointing at it.
 *
 * `useChartPressState` is generic over the shape it is initialised with, and
 * `CartesianChart` demands that shape match its own keys exactly — a
 * `Record<string, number>` is not assignable, which is the type system
 * correctly refusing a press state that could be watching a different chart.
 */
export type SlotValues = Record<Slot, number>;

/** A drawn series, paired with the slot and colour it was given. */
export type DrawnSeries = {
  series: Series;
  slot: Slot;
  colour: string;
  /** Where it sits relative to the zero line. */
  negative: boolean;
};

/**
 * The plotted series, in draw order, with their slots and colours resolved.
 *
 * `depth` rather than position decides the colour, and that distinction is
 * load-bearing: net revenue is the headline figure but comes third in the array
 * the dashboard builds, so keyed by position it would be drawn in the palest
 * step available. Draw order and visual weight are different decisions, which
 * is why `Series` carries a separate knob for the second one.
 */
export function drawnSeries(series: readonly Series[], tone: ChartTone): DrawnSeries[] {
  const drawable = plotted(series);

  if (__DEV__ && drawable.length > MAX_PLOTTED) {
    /*
     * Loud, and only in development. The alternative — dropping the fourth
     * silently — ships a chart that is missing a measure nobody can see is
     * missing, and the alternative to *that* — throwing — takes down a seller's
     * dashboard over a styling mistake. So: the chart still draws, and whoever
     * wrote the call site finds out immediately.
     */
    console.warn(
      `[Chart] ${drawable.length} plotted series; the palette carries ${MAX_PLOTTED}. ` +
        `Extras are not drawn — facet into separate charts, or mark one readoutOnly.`,
    );
  }

  return drawable.slice(0, MAX_PLOTTED).map((s, index) => ({
    series: s,
    slot: SLOTS[index] ?? "s0",
    colour: chartColour(tone, s.depth ?? index),
    negative: s.negative === true,
  }));
}

/**
 * The rows themselves.
 *
 * A negative series is flipped here and nowhere else. `Series.negative` means
 * "this is money leaving", and the value is *stored* positive — a refund is a
 * positive amount refunded — so the sign is a drawing decision. Flipping it at
 * the point the data enters the renderer means the marks, the domain and the
 * axis all agree without any of them having to remember, while `snapshotAt`
 * keeps reading the unflipped series for the readout. A reader is told
 * "Refunds $40", not "Refunds −$40"; only the picture knows which side of the
 * line that belongs on.
 */
export function chartRows(days: readonly string[], drawn: readonly DrawnSeries[]): ChartRow[] {
  return days.map((_day, index) => {
    const row: ChartRow = { x: index, s0: 0, s1: 0, s2: 0 };
    for (const entry of drawn) {
      const raw = entry.series.values[index] ?? 0;
      row[entry.slot] = entry.negative ? -Math.abs(raw) : raw;
    }
    return row;
  });
}
