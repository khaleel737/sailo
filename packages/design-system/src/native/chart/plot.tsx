import { useCallback } from "react";
import { DashPathEffect, Line, Rect, vec } from "@shopify/react-native-skia";
import { CartesianChart, useChartPressState } from "victory-native";
import { useAnimatedReaction, useDerivedValue, runOnJS } from "react-native-reanimated";
import type { Domain } from "../../chart";
import { useTheme } from "../theme";
import { useAxisFont } from "./font";
import { Marks } from "./marks";
import { SLOTS, type ChartRow, type DrawnSeries, type SlotValues } from "./rows";

/** The press state this plot's chart produces, named so `CursorBand` can take it. */
type PressState = ReturnType<
  typeof useChartPressState<{ x: number; y: SlotValues }>
>["state"];

/**
 * The drawing surface: grid, baseline, marks, day axis, and the cursor.
 *
 * WHY `CartesianChart` AND NOT A BARE `Canvas`
 * What it is here for is the frame, not the picture. It owns the scales, the
 * bounds left over once the axis has taken its room, the tick placement and
 * label collision handling on the day axis, and the pan gesture that turns a
 * finger into an index. Every mark inside it is drawn by `marks.tsx` against
 * `@sailo/design-system/chart`'s own geometry, which is the same arrangement `apps/web`
 * has with visx: the library supplies scales and an axis, the product supplies
 * the marks and every rule about what they mean.
 *
 * **The y domain is passed in, never inferred.** That is the whole reason this
 * library was chosen over one that computes its own: `chartDomain()` is shared
 * with the web, and a phone and a laptop disagreeing about where the peak is
 * reads to a seller as the app and the website telling them different things.
 *
 * WHICH THREAD OWNS WHAT
 * The cursor is a Reanimated `SharedValue`, so the highlight under the finger
 * moves on the UI thread and keeps up with a drag. The *index* it resolves to
 * is pushed back to React — but only when it actually changes, which is once
 * per band crossed rather than once per frame. So the readout, the dimming and
 * the announced value re-render perhaps thirty times across a full scrub
 * instead of sixty times a second, and the thing that has to be smooth never
 * waits on the thing that has to be correct.
 */

/**
 * How much vertical room the canvas takes, axis included.
 *
 * Deliberately taller than the web's 132: a phone is read at arm's length in
 * worse light, and a card on a phone has the vertical room a dashboard column
 * does not.
 *
 * Exported because the empty state has to reserve exactly the same height. Two
 * numbers agreeing by comment is two numbers that will disagree; sharing one is
 * what keeps a card from changing height the moment a shop makes its first sale.
 */
export const PLOT_HEIGHT = 190;

/** Horizontal grid lines. Three, as on the web — enough to judge a height by. */
const GRID_LINES = 3;

/**
 * The most day labels the axis will try to fit.
 *
 * Five at phone width, and fewer when the window is shorter than that. The web
 * uses the same ceiling; what differs is that Dynamic Type can grow a label
 * past its slot here, so `font.ts` caps its own scaling and this thins out
 * rather than letting them collide.
 */
const MAX_TICKS = 5;

export type PlotProps = {
  rows: readonly ChartRow[];
  drawn: readonly DrawnSeries[];
  domain: Domain;
  shape: "bar" | "line";
  /** The day under the finger, held in React so the readout can render it. */
  cursor: number | null;
  onCursor: (index: number | null) => void;
  /** Renders the day at `index` for the axis. */
  dayLabel: (index: number) => string;
};

export function Plot({
  rows,
  drawn,
  domain,
  shape,
  cursor,
  onCursor,
  dayLabel,
}: PlotProps) {
  const { colors } = useTheme();
  const font = useAxisFont();
  const { state } = useChartPressState({ x: 0, y: { s0: 0, s1: 0, s2: 0 } });

  /*
   * The gesture, reported to React once per day rather than once per frame.
   *
   * `runOnJS` costs a hop across the bridge, so it is guarded twice: the
   * reaction only fires when its watched value changes, and the watched value
   * is the *index*, not the position. Watching the position instead — the
   * obvious version — would fire on every pixel of a drag and hand the JS
   * thread sixty setStates a second to do nothing with.
   */
  const report = useCallback(
    (index: number | null) => onCursor(index),
    [onCursor],
  );

  useAnimatedReaction(
    () => (state.isActive.value ? Math.round(state.matchedIndex.value) : null),
    (index, previous) => {
      if (index !== previous) runOnJS(report)(index);
    },
    [report],
  );

  return (
    <CartesianChart
      data={rows as ChartRow[]}
      xKey="x"
      yKeys={SLOTS}
      /*
       * The shared domain, handed over whole. `nice: true` is deliberately not
       * asked for: rounding the axis outward would move the top of the tallest
       * bar away from the top of the plot, and the web does not round either —
       * the two would then draw the same week at two different heights.
       */
      domain={{ y: [domain.min, domain.max || 1] }}
      /*
       * A little room at each end so the first and last bar are not flush
       * against the card's edge, and none at top or bottom — the domain already
       * contains zero and the tallest day should reach the ceiling.
       */
      domainPadding={{ left: 2, right: 2 }}
      chartPressState={state}
      /*
       * The plot lives inside a vertical `ScrollView`. Without this, a drag
       * that starts with any vertical component is claimed by the scroll view
       * and the chart never sees it — which reads as a chart that only responds
       * to perfectly horizontal fingers.
       */
      chartPressConfig={{ pan: { activeOffsetX: [-8, 8], failOffsetY: [-24, 24] } }}
      /*
       * Labels only — `lineWidth: 0` suppresses the vertical grid the web does
       * not draw either. Ticks are the library's job because the failure it
       * prevents is fiddly and invisible in review: a label centred on a column
       * against the card's edge loses half of itself, which is how "Jul 8"
       * shipped as "ul 8" on the web until somebody photographed it.
       */
      xAxis={{
        font,
        lineWidth: 0,
        labelColor: colors.contentMuted,
        tickCount: Math.min(MAX_TICKS, rows.length),
        formatXLabel: (index) => dayLabel(Number(index)),
      }}
      frame={{ lineWidth: 0 }}
    >
      {({ chartBounds, yScale, yTicks }) => {
        const bands = {
          left: chartBounds.left,
          step: (chartBounds.right - chartBounds.left) / Math.max(1, rows.length),
          count: rows.length,
        };

        return (
          <>
            <Grid bounds={chartBounds} ticks={yTicks} yScale={yScale} colour={colors.borderSubtle} />

            {/*
              The zero line. Solid once something hangs below it, a hint when
              nothing does — a dashed rule reads as "this is where zero would
              be", a solid one as "this is a boundary things cross".
            */}
            <Line
              p1={vec(chartBounds.left, yScale(0))}
              p2={vec(chartBounds.right, yScale(0))}
              color={domain.min < 0 ? colors.border : colors.borderSubtle}
              strokeWidth={1}
            >
              {domain.min < 0 ? null : <DashPathEffect intervals={[2, 3]} />}
            </Line>

            {/*
              The day under the finger, marked behind everything it explains.
              Driven straight off the shared value, so it tracks the drag rather
              than waiting for React to agree which day it is.
            */}
            <CursorBand
              state={state}
              bands={bands}
              top={chartBounds.top}
              height={chartBounds.bottom - chartBounds.top}
              colour={colors.content}
            />

            <Marks
              drawn={drawn}
              bands={bands}
              yScale={yScale}
              shape={shape}
              cursor={cursor}
              emptyColour={colors.borderSubtle}
              surfaceColour={colors.surface}
            />
          </>
        );
      }}
    </CartesianChart>
  );
}

/** The horizontal rules a reader judges one bar's height against another by. */
function Grid({
  bounds,
  ticks,
  yScale,
  colour,
}: {
  bounds: { left: number; right: number };
  ticks: number[];
  yScale: (value: number) => number;
  colour: string;
}) {
  /*
   * The library offers more ticks than a phone-width card wants, so they are
   * thinned here rather than asked for — `yTicks` is also what the domain is
   * measured in, and requesting three would round the scale as well as the
   * grid.
   */
  const step = Math.max(1, Math.ceil(ticks.length / GRID_LINES));

  return (
    <>
      {ticks
        .filter((_, index) => index % step === 0)
        .map((tick) => (
          <Line
            key={tick}
            p1={vec(bounds.left, yScale(tick))}
            p2={vec(bounds.right, yScale(tick))}
            color={colour}
            strokeWidth={1}
          />
        ))}
    </>
  );
}

/**
 * The highlight under the reader's finger.
 *
 * Its own component because everything in it is a `SharedValue`: putting these
 * derivations in `Plot` would make the whole plot a subscriber to a value that
 * changes sixty times a second, which is exactly the re-render the split
 * between the threads exists to avoid.
 */
function CursorBand({
  state,
  bands,
  top,
  height,
  colour,
}: {
  state: PressState;
  bands: { left: number; step: number; count: number };
  top: number;
  height: number;
  colour: string;
}) {
  const x = useDerivedValue(() => {
    const index = Math.min(Math.max(Math.round(state.matchedIndex.value), 0), bands.count - 1);
    return bands.left + index * bands.step;
  }, [bands.left, bands.step, bands.count]);

  /* Zero when nothing is being pointed at, so the band is absent rather than
     drawn in a colour that happens to be invisible. */
  const opacity = useDerivedValue(() => (state.isActive.value ? 0.07 : 0), []);

  return <Rect x={x} y={top} width={bands.step} height={height} color={colour} opacity={opacity} />;
}
