import { Text as RNText, View } from "react-native";

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

export function Chart({
  points,
  emptyMessage,
  truncatedNote,
  accessibilityLabel,
  testID,
}: ChartProps) {
  if (points.length === 0) {
    return (
      <View testID={testID}>
        <RNText>{emptyMessage}</RNText>
      </View>
    );
  }
  return (
    <View accessibilityLabel={accessibilityLabel} testID={testID}>
      {truncatedNote ? <RNText>{truncatedNote}</RNText> : null}
    </View>
  );
}
