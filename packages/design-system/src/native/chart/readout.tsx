import { StyleSheet, View } from "react-native";
import { chartColour, sumOf, type ChartTone, type Series } from "../../chart";
import { Text } from "../text";
import { useTheme } from "../theme";

/**
 * What the pointed-at day was worth, per series.
 *
 * This is the piece the phone was missing that mattered most. Its old chart
 * printed one line — the first series' value — so a revenue card could show
 * sales and refunds and then tell the reader about exactly one of them, and net
 * (which is the number a seller actually wants) was not on the card at all.
 *
 * Always present, never a tooltip. Window totals at rest, the day's figures
 * while a finger is down. A tooltip beside the cursor has to solve flipping at
 * both edges, it covers the marks it is describing, and on a phone it sits
 * directly under the thumb — while a reader looks at the same fixed spot each
 * time regardless of where they are pointing.
 *
 * It is also the chart's legend, which is why the dot is here and not floating
 * above the plot: `dataviz` requires that identity never rests on colour alone,
 * and every series is named in words a step *larger* than the label beside it.
 */
export function ChartReadout({
  series,
  tone,
  values,
  periodLabel,
  format,
}: {
  series: readonly Series[];
  tone: ChartTone;
  /** Per-series figures for the pointed-at day, or null for window totals. */
  values: Map<string, number> | null;
  periodLabel: string;
  format: (value: number) => string;
}) {
  const { space } = useTheme();

  return (
    <View
      style={[styles.row, { columnGap: space.lg, rowGap: space.xs }]}
      /*
       * One announcement, not one per series. Read element by element this is
       * "30 days", "Sales", "$4,120", "Refunds", "$210" — five stops that a
       * screen-reader user has to hold in their head and pair up. Grouped, it
       * is one stop that says the sentence.
       */
      accessible
      accessibilityLabel={[
        periodLabel,
        ...series.map(
          (s) => `${s.label} ${format(values ? (values.get(s.key) ?? 0) : sumOf(s))}`,
        ),
      ].join(". ")}
    >
      <Text variant="caption" weight="medium" tone="muted" tabular>
        {periodLabel}
      </Text>

      {series.map((s, index) => (
        <View key={s.key} style={[styles.item, { gap: space.xs }]}>
          {/*
            The swatch. `readoutOnly` series get none, deliberately: net is not
            drawn, so a dot claiming a colour for it would send the reader
            looking for a mark that is not in the plot.
          */}
          {s.readoutOnly ? null : (
            <View
              style={[styles.dot, { backgroundColor: chartColour(tone, s.depth ?? index) }]}
            />
          )}
          <Text variant="caption" tone="muted">
            {s.label}
          </Text>
          {/*
            A step larger than its own label, and the reason the disclosure
            table this replaced went away: this is the number that moves as the
            reader scrubs, so it cannot be the smallest text on the card,
            separated from its label by weight alone.
          */}
          <Text variant="callout" weight="semibold" tabular>
            {format(values ? (values.get(s.key) ?? 0) : sumOf(s))}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  item: { flexDirection: "row", alignItems: "center" },
  /* Not a perfect circle by accident: 8pt is the smallest a filled dot reads as
     a colour rather than as a speck at typical phone pixel densities. */
  dot: { width: 8, height: 8, borderRadius: 4 },
});
