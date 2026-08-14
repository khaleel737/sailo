import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { formatMoney } from "@sailo/core/currency";
import { Text } from "./text";

/** One reading. `label` is the x-axis tick; `value` is what is being counted. */
export type ChartPoint = {
  /** Already formatted for display — "Mon", "12 Aug". */
  label: string;
  value: number;
};

/**
 * A small series, drawn honestly.
 *
 * Three of these props exist to stop a chart lying, which is the only thing
 * that makes charts worth having in an app this size:
 *
 *   - `emptyMessage` is required. A line chart over no data draws a flat line
 *     at zero, which reads as "you sold nothing" rather than "there is nothing
 *     here yet" — and those are different things to tell a seller.
 *   - `truncatedNote` is where a bounded window admits itself. A series cut to
 *     the last 30 points must say so on the chart, not in a comment.
 *   - `accessibilityLabel` is required, because a chart is entirely invisible to
 *     a screen reader otherwise. Summarise the trend in a sentence.
 *
 * `minor` for currency, for the same reason `Money` takes it: the values are
 * whatever the query returned, and rounding to whole units before plotting is
 * how a total stops matching the list below it.
 */
export type ChartProps = {
  /** @default "line" */
  kind?: "line" | "bar";
  points: readonly ChartPoint[];
  /**
   * What the y axis counts. `currency` formats the axis and the summary through
   * the shared money formatter and requires `currency`; `count` does not.
   */
  unit: "currency" | "count";
  /** ISO 4217. Required when `unit` is `"currency"`. */
  currency?: string;
  /** Drawn instead of the chart when `points` is empty. Required — see above. */
  emptyMessage: string;
  /**
   * Says what was left out when the series is a window rather than everything —
   * "Last 30 days". Drawn under the chart, never omitted when it applies.
   */
  truncatedNote?: string;
  /** @default "md" */
  height?: "sm" | "md" | "lg";
  /** A sentence describing the shape, for a reader who cannot see it. */
  accessibilityLabel: string;
  testID?: string;
};

/**
 * A primitive, not a chart.
 *
 * Axes, a grid, a line or bars, an area under them and a dot on the last
 * reading. It does not know what a week is, it does not fetch, and it has no
 * opinion about which series belong together — A09 composes the actual charts
 * out of this. Everything it does know how to do is a thing that would
 * otherwise be re-derived per screen: where zero sits, how to keep a flat
 * series off the floor, and how to say a number on an axis.
 */
export function Chart({
  kind = "line",
  points,
  unit,
  currency,
  emptyMessage,
  truncatedNote,
  height = "md",
  accessibilityLabel,
  testID,
}: ChartProps) {
  const { theme } = useUnistyles();
  /*
   * SVG needs a pixel width and React Native only knows one after layout. The
   * chart draws nothing on the first frame and everything on the second, which
   * is invisible — and is why the plot has an explicit height: without one the
   * container would be zero-tall on that first pass and the layout would jump.
   */
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  styles.useVariants({ height });

  if (points.length === 0) {
    return (
      <View style={styles.container} testID={testID}>
        <View style={styles.empty}>
          <Text variant="callout" tone="muted" align="center">
            {emptyMessage}
          </Text>
        </View>
        {truncatedNote ? <Note text={truncatedNote} /> : null}
      </View>
    );
  }

  const plotHeight = theme.components.chart.height[height];
  const values = points.map((point) => point.value);
  const max = Math.max(...values);
  const min = Math.min(...values, 0);

  /*
   * Zero is always on the axis, and the top is never the tallest bar exactly —
   * a series whose maximum touches the frame reads as clipped. A flat series
   * gets an invented span of 1 so it draws along the bottom instead of dividing
   * by zero and vanishing.
   */
  const span = max - min || 1;
  const yOf = (value: number) => plotHeight - ((value - min) / span) * plotHeight;

  return (
    <View style={styles.container} testID={testID}>
      {/*
       * One accessible element for the whole plot. A screen reader given
       * thirty unlabelled `<Path>` elements reads thirty nothings; given this
       * it reads the sentence the caller wrote, which is the only description
       * of a shape that has ever been useful.
       */}
      <View
        style={styles.plot}
        onLayout={onLayout}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
      >
        {width > 0 ? (
          <Svg width={width} height={plotHeight}>
            {/* Grid: the floor and the ceiling of the range, and nothing else. */}
            {[0, 0.5, 1].map((fraction) => (
              <Line
                key={fraction}
                x1={0}
                x2={width}
                y1={plotHeight * fraction}
                y2={plotHeight * fraction}
                stroke={theme.colors.border}
                strokeWidth={theme.components.chart.gridWidth}
              />
            ))}

            {kind === "bar"
              ? points.map((point, index) => {
                  const slot = width / points.length;
                  const barWidth = slot * theme.components.chart.barFill;
                  const top = yOf(point.value);
                  return (
                    <Rect
                      key={`${point.label}-${index}`}
                      x={index * slot + (slot - barWidth) / 2}
                      y={top}
                      width={barWidth}
                      /* Never negative: a zero-value bar is a hairline, not an inversion. */
                      height={Math.max(1, plotHeight - top)}
                      rx={2}
                      fill={theme.colors.accent}
                    />
                  );
                })
              : null}

            {kind === "line" ? (
              <>
                {/*
                 * The area is drawn first so the line sits on top of it, and
                 * it is faint: it exists to give the line a body, not to be
                 * read as a second series.
                 */}
                <Path
                  d={areaPath(points, width, plotHeight, yOf)}
                  fill={theme.colors.accent}
                  fillOpacity={theme.components.chart.areaOpacity}
                />
                <Path
                  d={linePath(points, width, yOf)}
                  stroke={theme.colors.accent}
                  strokeWidth={theme.components.chart.lineWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
                {/*
                 * The endpoint. A line that stops mid-air leaves the reader
                 * wondering whether the series ended or the chart ran out;
                 * a dot says "this is the latest reading".
                 */}
                <Circle
                  cx={xOf(points.length - 1, points.length, width)}
                  cy={yOf(points[points.length - 1]!.value)}
                  r={theme.components.chart.endpointRadius}
                  fill={theme.colors.accent}
                  stroke={theme.colors.surface}
                  strokeWidth={2}
                />
              </>
            ) : null}
          </Svg>
        ) : null}
      </View>

      {/*
       * The two ends of the axis, and nothing between them. Thirty date labels
       * at 13pt do not fit on a phone, and shrinking them until they do is how
       * a chart ends up with an axis nobody can read — so it shows the range
       * and lets the accessibility label carry the detail.
       */}
      <View style={styles.axis} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {points[0]!.label}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {formatValue(max, unit, currency)}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1} align="end">
          {points[points.length - 1]!.label}
        </Text>
      </View>

      {truncatedNote ? <Note text={truncatedNote} /> : null}
    </View>
  );
}

/**
 * The bound, admitting itself.
 *
 * Its own component only so that the empty state and the drawn chart cannot
 * render it differently — a window that says "Last 30 days" under a chart and
 * nothing under the empty version of the same chart is the bound going quiet
 * exactly when the reader has least to go on.
 */
function Note({ text }: { text: string }) {
  return (
    <Text variant="caption" tone="muted">
      {text}
    </Text>
  );
}

/** The x of point `index`, with the first and last sitting on the edges. */
function xOf(index: number, count: number, width: number): number {
  if (count <= 1) return width / 2;
  return (index / (count - 1)) * width;
}

function linePath(
  points: readonly ChartPoint[],
  width: number,
  yOf: (value: number) => number,
): string {
  return points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${xOf(index, points.length, width).toFixed(2)} ${yOf(point.value).toFixed(2)}`;
    })
    .join(" ");
}

/** The same line, closed down to the baseline and back. */
function areaPath(
  points: readonly ChartPoint[],
  width: number,
  plotHeight: number,
  yOf: (value: number) => number,
): string {
  const last = xOf(points.length - 1, points.length, width).toFixed(2);
  const first = xOf(0, points.length, width).toFixed(2);
  return `${linePath(points, width, yOf)} L${last} ${plotHeight} L${first} ${plotHeight} Z`;
}

/**
 * The top of the range, in the unit being counted.
 *
 * Currency goes through `formatMoney` for the same reason `Money` does: the
 * values are minor units, and a yen is its own minor unit. An axis that divided
 * by a hundred would disagree with the totals in the list below the chart, and
 * the chart is the one a seller would believe.
 */
function formatValue(value: number, unit: ChartProps["unit"], currency?: string): string {
  if (unit === "currency" && currency) return formatMoney(value, currency);
  return String(Math.round(value));
}

const styles = StyleSheet.create((theme) => ({
  container: {
    alignSelf: "stretch",
    gap: theme.space.sm,
  },
  plot: {
    alignSelf: "stretch",

    variants: {
      height: {
        sm: { height: theme.components.chart.height.sm },
        md: { height: theme.components.chart.height.md },
        lg: { height: theme.components.chart.height.lg },
      },
    },
  },
  /*
   * The empty state takes the same height the plot would have. A chart that
   * collapses to one line of text when a shop has no orders yet moves
   * everything under it up the screen, and then back down on the first sale.
   */
  empty: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.components.card.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
    paddingHorizontal: theme.space.lg,

    variants: {
      height: {
        sm: { height: theme.components.chart.height.sm },
        md: { height: theme.components.chart.height.md },
        lg: { height: theme.components.chart.height.lg },
      },
    },
  },
  axis: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
    minHeight: theme.components.chart.axisHeight,
  },
}));
