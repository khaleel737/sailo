import { useCallback, useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { formatMoney } from "@sailo/core/currency";
import {
  chartDomain,
  hasData,
  indexAtPointer,
  peak,
  snapshotAt,
  toPercent,
  type Series,
} from "@sailo/core/chart";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * One series, drawn.
 *
 * The arithmetic is not here. `@sailo/core/chart` owns the domain, the peak,
 * the "is there data at all" test and the floor that keeps a zero day visible —
 * the same functions `apps/web` feeds into visx. Only the drawing is local,
 * because visx emits DOM SVG and React Native has no DOM: web renders with
 * visx, this renders with `react-native-svg`, and both are handed identical
 * numbers.
 *
 * Two renderers was unavoidable. Two *domains* would not have been, and a
 * phone and a laptop disagreeing about where the peak is reads to a seller as
 * the app and the website telling them different things.
 */
export type ChartPoint = {
  label: string;
  value: number;
};

export type ChartProps = {
  /** @default "bar" */
  kind?: "line" | "bar";
  points: readonly ChartPoint[];
  /** What the values are, so the accessible summary can say it. */
  unit: "currency" | "count";
  /** Required when `unit` is `currency`. */
  currency?: string;
  /** Shown instead of a plot when there is genuinely nothing to draw. */
  emptyMessage: string;
  /** Set when the window is longer than the plot covers. */
  truncatedNote?: string;
  /** @default "md" */
  height?: "sm" | "md" | "lg";
  /**
   * Formats the value a tap reveals. Given the raw value so the caller can
   * choose money or a plain count — the chart knows the number, not what it is
   * denominated in.
   */
  formatValue?: (value: number) => string;
  accessibilityLabel: string;
  testID?: string;
};

const HEIGHTS = { sm: 80, md: 140, lg: 200 } as const;

export function Chart({
  kind = "bar",
  points,
  unit,
  currency,
  emptyMessage,
  truncatedNote,
  height = "md",
  formatValue,
  accessibilityLabel,
  testID,
}: ChartProps) {
  const { colors, space } = useTheme();
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const h = HEIGHTS[height];

  /*
   * One `Series`, so the shared domain functions apply unchanged. The shape
   * this component takes is a flat list of points because that is what a screen
   * has; converting here rather than making every caller build a `Series` keeps
   * the shared type an implementation detail of the maths.
   */
  const series: Series[] = [
    { key: "value", label: accessibilityLabel, values: points.map((p) => p.value) },
  ];

  /*
   * Empty is a state, not a shorter chart. `hasData` is the same test the web
   * chart runs, so the two surfaces agree on what "nothing yet" means — and
   * drawing an axis anyway is the mistake this guard exists to prevent: Stan's
   * app renders a $0.00–$0.08 revenue scale on an account that has never sold
   * anything, which invents precision about nothing.
   */
  if (points.length === 0 || !hasData(series)) {
    return (
      <View
        style={{ height: h, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md }}
        testID={testID}
      >
        <Text variant="caption" tone="muted" align="center">
          {emptyMessage}
        </Text>
      </View>
    );
  }

  const domain = chartDomain(series);
  const top = peak(series);

  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  /*
   * Which day a finger is over, from the same function the web chart's pointer
   * readout uses. `indexAtPointer` clamps rather than returning null just past
   * the edge — a thumb a few pixels off the last bar means the last bar, not
   * "nothing", which is the difference between a readout that feels responsive
   * and one that keeps blanking.
   */
  const bands = { offset: 0, step: width / Math.max(1, points.length), count: points.length };
  const onTouch = useCallback(
    (x: number) => setCursor(indexAtPointer(x, bands)),
    [bands.step, bands.count],
  );

  const snapshot =
    cursor === null
      ? null
      : snapshotAt(
          cursor,
          points.map((p) => p.label),
          series,
        );

  return (
    <View style={{ gap: space.xs }} testID={testID}>
      {/*
        The readout sits above the plot and holds its height whether or not a
        finger is down. Rendering it only while touched would make the chart
        jump up as the thumb lands — moving the very thing being pointed at.
      */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", minHeight: 20, gap: space.sm }}>
        <Text variant="caption" tone="muted">
          {snapshot?.day ?? ""}
        </Text>
        <Text variant="caption" weight="semibold">
          {snapshot ? (formatValue ? formatValue(snapshot.values[0]?.value ?? 0) : String(snapshot.values[0]?.value ?? 0)) : ""}
        </Text>
      </View>

      <Pressable
        onLayout={onLayout}
        onPressIn={(event) => onTouch(event.nativeEvent.locationX)}
        onTouchMove={(event) => onTouch(event.nativeEvent.locationX)}
        onPressOut={() => setCursor(null)}
        /*
         * A chart is one element to a screen reader, not sixty. The summary
         * below says the shape of the series; a tap target per bar would be
         * sixty stops on the way to the next control.
         */
        accessibilityRole="image"
        accessibilityLabel={`${accessibilityLabel}. ${summarise(points, top, unit, currency)}`}
        style={{ height: h }}
      >
        {/*
          Rendered only once the width is measured. An SVG drawn at width 0 and
          then re-drawn is a visible flash on every mount; a frame of nothing is
          not.
        */}
        {width > 0 ? (
          <Svg width={width} height={h}>
            {kind === "bar"
              ? points.map((point, i) => {
                  const band = width / points.length;
                  const w = Math.max(2, band * 0.7);
                  // `toPercent` is the shared scale — the floor that keeps a
                  // zero day visible lives inside it, so a bar of nothing is
                  // still a mark rather than a gap the eye reads as missing.
                  const pct = toPercent(point.value, domain);
                  const barH = Math.max(2, (pct / 100) * h);
                  return (
                    <Rect
                      key={`${point.label}-${i}`}
                      x={i * band + (band - w) / 2}
                      y={h - barH}
                      width={w}
                      height={barH}
                      rx={2}
                      fill={point.value > 0 ? colors.accent : colors.borderSubtle}
                    />
                  );
                })
              : (
                <Path
                  d={linePath(points, domain, width, h)}
                  stroke={colors.accent}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              )}
            {/* The marker for the day under the finger. Drawn last so it sits
                over the series rather than behind it. */}
            {cursor !== null && points[cursor] ? (
              <Rect
                x={cursor * (width / points.length)}
                y={0}
                width={Math.max(1, width / points.length)}
                height={h}
                fill={colors.content}
                opacity={0.08}
              />
            ) : null}
          </Svg>
        ) : null}
      </Pressable>

      {/*
        Only the ends are labelled. Sixty labels under sixty columns is a grey
        smear; the first and last date is what actually orients a reader.
      */}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text variant="caption" tone="muted">
          {points[0]?.label ?? ""}
        </Text>
        <Text variant="caption" tone="muted">
          {points.at(-1)?.label ?? ""}
        </Text>
      </View>

      {truncatedNote ? (
        <Text variant="caption" tone="muted">
          {truncatedNote}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The polyline, as an SVG path.
 *
 * Straight segments rather than a spline. The web chart curves with
 * `curveMonotoneX`, which is right for a wide plot with room between points;
 * at phone width sixty days sit a few pixels apart and a curve through them
 * reads as noise while inventing values between the days that were measured.
 */
function linePath(
  points: readonly ChartPoint[],
  domain: { min: number; max: number },
  width: number,
  height: number,
): string {
  if (points.length === 1) {
    const y = height - (toPercent(points[0]!.value, domain) / 100) * height;
    return `M 0 ${y} L ${width} ${y}`;
  }
  const step = width / (points.length - 1);
  return points
    .map((point, i) => {
      const y = height - (toPercent(point.value, domain) / 100) * height;
      return `${i === 0 ? "M" : "L"} ${i * step} ${y}`;
    })
    .join(" ");
}

/**
 * What VoiceOver says instead of reading sixty bars.
 *
 * A chart is one image to a screen reader, so the useful thing to announce is
 * the shape of the series — its total and its peak — not a list nobody can hold
 * in their head. The peak comes from the shared `peak()`, so the phone names
 * the same day the web readout does.
 */
function summarise(
  points: readonly ChartPoint[],
  top: { index: number; value: number; label: string } | null,
  unit: "currency" | "count",
  currency?: string,
): string {
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const fmt = (n: number) =>
    unit === "currency" && currency ? formatMoney(Math.round(n * 100), currency) : String(Math.round(n));
  const peakLabel = top ? points[top.index]?.label ?? "" : "";
  return top
    ? `Total ${fmt(total)}. Highest ${fmt(top.value)} on ${peakLabel}.`
    : `Total ${fmt(total)}.`;
}
