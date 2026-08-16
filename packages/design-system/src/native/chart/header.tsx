import { type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { Peak } from "../../chart";
import { Text } from "../text";
import { useTheme } from "../theme";

/**
 * The title, the headline figure, and the day worth calling out.
 *
 * The phone had none of this. Its chart was a plot with a heading above it in
 * the *screen*, so the card carried no total and no peak — which meant the only
 * way to learn what a month was worth was to scrub the whole month and add it
 * up. The web card has answered both questions at rest since it was written.
 *
 * The peak prints its value first and the word after it. An earlier web version
 * had only the index to work with and rendered the label above a date with no
 * number anywhere near it — a label with nothing to label.
 */
export function ChartHeader({
  title,
  total,
  peak,
  peakDay,
  peakWord,
  format,
  action,
}: {
  title: string;
  total: string;
  peak: Peak | null;
  peakDay: string | undefined;
  /** "peak", localised. Interpolated with the series' own name by the caller. */
  peakWord: string;
  format: (value: number) => string;
  /** The bar-or-line switch, when the chart offers one. */
  action?: ReactNode;
}) {
  const { space } = useTheme();

  return (
    <View style={[styles.row, { gap: space.md }]}>
      <View style={styles.lead}>
        <Text variant="callout" tone="muted" numberOfLines={1}>
          {title}
        </Text>
        {/*
          `title` rather than `display`: this sits inside a card next to a
          switch, not at the top of a screen, and 34pt would make the chart the
          thing under the number rather than the number a summary of the chart.

          `tabular` because the figure is live — it is the window total at rest
          and the pointed-at day's while scrubbing, and proportional digits make
          it visibly shiver as `1`s become `8`s.
        */}
        <Text variant="title" tabular numberOfLines={1}>
          {total}
        </Text>

        {/*
          THE PEAK, ON ONE LINE, UNDER THE FIGURE IT QUALIFIES.

          It was three right-aligned caption lines in a column of its own — the
          value, the word, and the day, stacked in the card's top-right corner
          with the shape switch beneath them. Four rows against the two on the
          left, which made the header about 150 points tall before the plot
          started, and made the right-hand side read as a fragment of a
          paragraph rather than as a fact.

          It also duplicated the headline on any window with a single active
          day: the card said "$396" as the total and "$396" again as the peak,
          eight points apart, which reads as the interface repeating itself.

          One caption line, in the lead column, directly under the number it is
          a footnote about — which is what it is. It truncates rather than
          wrapping, because a two-line footnote reintroduces the ragged header
          this replaced.
        */}
        {peak && peakDay ? (
          <Text variant="caption" tone="muted" tabular numberOfLines={1}>
            {`${peakWord} ${format(peak.value)} · ${peakDay}`}
          </Text>
        ) : null}
      </View>

      {/* The shape switch, top-aligned against the title rather than floating
          below a stack of captions. */}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  lead: { flex: 1, minWidth: 0 },
});
