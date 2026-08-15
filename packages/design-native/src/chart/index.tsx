import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  chartDomain,
  hasData,
  peak,
  snapshotAt,
  sumOf,
  type ChartShape,
  type ChartTone,
  type Series,
} from "@sailo/core/chart";
import { Text } from "../text";
import { useTheme } from "../theme";
import { ChartHeader } from "./header";
import { ChartReadout } from "./readout";
import { Plot, PLOT_HEIGHT } from "./plot";
import { VariantSwitch } from "./variant-switch";
import { chartRows, drawnSeries } from "./rows";

export type { ChartShape, ChartTone, Series };

/**
 * A multi-series day chart. One shape at a time, over one shared domain.
 *
 * WHAT THIS REPLACED, AND WHY THE PROPS CHANGED
 *
 * The previous `Chart` took `{ points, kind }` — a flat list of label/value
 * pairs and a shape — which could hold exactly one measure. That is why the
 * phone's revenue card drew net revenue as a single line while the web's drew
 * sales, refunds below the zero line, and net in the readout: the component had
 * no way to be handed the other two.
 *
 * `packages/design-native/src/index.ts` says the prop types are frozen and that
 * changing one "needs saying out loud rather than doing", so: **this is a
 * breaking change to `ChartProps`, and it is deliberate.** The new shape is
 * `apps/web`'s `ChartProps`, prop for prop, so the same data builds the same
 * card on both surfaces and a change can never land on one and not the other.
 * The cost was two call sites, both in `(tabs)/insights/index.tsx`.
 *
 * WHERE THE WORK HAPPENS
 * This file owns state and layout only. The arithmetic is in
 * `@sailo/core/chart`, the frame and scales are in `plot`, the marks are in
 * `marks`, and the figures are in `header` and `readout` — the same split
 * `apps/web/src/components/shared/chart/` has, file for file, so a fix to one
 * surface has an obvious counterpart on the other.
 *
 * NOTHING IS PLOTTED UNTIL THERE IS SOMETHING TO PLOT
 * `hasData` is the same test the web runs. A brand-new shop has no visits and
 * no revenue, and the tempting thing is to draw the axis anyway — which is what
 * Stan's app does, rendering a $0.00–$0.08 revenue scale to a seller who has
 * never sold anything. That is a chart of nothing with invented precision, and
 * it is the first thing a new seller ever sees.
 */

export type ChartProps = {
  title: string;
  /** ISO days, one per column, shared by every series. */
  days: readonly string[];
  series: readonly Series[];
  /**
   * Which entity this measures, not which colour to use. Call sites cannot
   * invent a hue — that is how the same measure came out indigo on one screen
   * and teal on another. See `@sailo/core/chart/palette`.
   */
  tone: ChartTone;
  unit: "count" | "money";
  /** Required when `unit` is `money`. */
  currency?: string;
  /** Shown instead of a plot when there is genuinely nothing to draw. */
  emptyLabel: string;
  /**
   * The headline figure. Defaults to the sum of the first series; name a
   * different one when the total that matters is derived, as net revenue is.
   */
  totalKey?: string;
  /** What the chart draws until the reader says otherwise. @default "bar" */
  defaultShape?: ChartShape;
  /** Offer the reader bars-or-line. Requires `shapeLabels`. */
  switchable?: boolean;
  /** Words for the bars-or-line control, including the group's own name. */
  shapeLabels?: { bar: string; line: string; legend: string };
  /**
   * The words around the figures, localised by the caller.
   *
   * A component in this package never holds a string a reader sees — there is
   * no dictionary down here and no hook to read one with, and a literal would
   * be untranslated in 34 languages.
   */
  labels: {
    /** "peak", for the callout beside the headline. */
    peak: string;
    /** Already interpolated — "30 days", "7 days". */
    window: string;
  };
  /** Set when the window is longer than the plot covers. */
  truncatedNote?: string;
  /** Punctuates the figures. Money and thousands separators are per-locale. */
  locale: string;
  /** Formats one day for the axis and the readout. */
  formatDay: (isoDay: string) => string;
  /** Formats a value for the readout, the headline and the peak. */
  formatValue: (value: number) => string;
  testID?: string;
};

export function Chart({
  title,
  days,
  series,
  tone,
  emptyLabel,
  totalKey,
  defaultShape = "bar",
  switchable = false,
  shapeLabels,
  labels,
  truncatedNote,
  formatDay,
  formatValue,
  testID,
}: ChartProps) {
  const { space } = useTheme();
  const [cursor, setCursor] = useState<number | null>(null);
  const [chosenShape, setChosenShape] = useState<ChartShape | null>(null);

  const shape = chosenShape ?? defaultShape;

  const populated = hasData(series);
  const domain = useMemo(() => chartDomain(series), [series]);
  const top = useMemo(() => peak(series), [series]);
  const drawn = useMemo(() => drawnSeries(series, tone), [series, tone]);
  const rows = useMemo(() => chartRows(days, drawn), [days, drawn]);

  const snapshot = cursor === null ? null : snapshotAt(cursor, days, series);
  const readoutValues = useMemo(
    () => (snapshot ? new Map(snapshot.values.map((v) => [v.key, v.value])) : null),
    [snapshot],
  );

  /*
   * The headline. `totalKey` names it when it is derived: net revenue is third
   * in the array the dashboard builds, and defaulting to the first series would
   * put gross sales in the slot labelled "Net".
   */
  const headline = series.find((s) => s.key === totalKey) ?? series[0];
  const total = formatValue(sumOf(headline));

  /*
   * The switch is offered only when there is a shape worth choosing between.
   * On an empty card it would be a control over nothing, and without labels it
   * would be a control nobody could read — so both are required, and the type
   * cannot express "these two travel together" without making the common case
   * verbose.
   */
  const offerSwitch = switchable && populated && shapeLabels !== undefined;

  return (
    <View style={{ gap: space.sm }} testID={testID}>
      <ChartHeader
        title={title}
        total={total}
        peak={top}
        peakDay={top ? formatDay(days[top.index] ?? "") : undefined}
        peakWord={labels.peak}
        format={formatValue}
        action={
          offerSwitch && shapeLabels ? (
            <VariantSwitch value={shape} onChange={setChosenShape} labels={shapeLabels} />
          ) : null
        }
      />

      {populated ? (
        <View style={styles.plot}>
          <Plot
            rows={rows}
            drawn={drawn}
            domain={domain}
            shape={shape}
            cursor={cursor}
            onCursor={setCursor}
            dayLabel={(index) => formatDay(days[index] ?? "")}
          />
        </View>
      ) : (
        /*
         * Empty is a state, not a shorter chart. Held at the plot's own height
         * so a card that fills in later does not jump the page under the
         * reader's thumb.
         */
        <View style={styles.empty}>
          <Text variant="caption" tone="muted" align="center">
            {emptyLabel}
          </Text>
        </View>
      )}

      <ChartReadout
        series={series}
        tone={tone}
        values={readoutValues}
        periodLabel={snapshot ? formatDay(snapshot.day) : labels.window}
        format={formatValue}
      />

      {truncatedNote ? (
        <Text variant="caption" tone="muted">
          {truncatedNote}
        </Text>
      ) : null}
    </View>
  );
}

/*
 * Both boxes take their height from `plot.tsx`'s own constant, so the card is
 * the same height whether or not the shop has sold anything. A second number
 * here would be a card that changes size on the day of the first sale.
 */
const styles = StyleSheet.create({
  plot: { height: PLOT_HEIGHT },
  empty: { height: PLOT_HEIGHT, alignItems: "center", justifyContent: "center" },
});
