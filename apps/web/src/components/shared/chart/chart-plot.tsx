"use client";

import { useMemo } from "react";
import { AxisBottom } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { localPoint } from "@visx/event";
import { scaleBand, scaleLinear } from "@visx/scale";
import { indexAtPointer } from "@/lib/chart";
import type { ChartShape, ChartTone, Domain, Series } from "@/lib/chart";
import { ChartSeries } from "./chart-series";

export const PLOT_HEIGHT = 132;
/**
 * Room under the plot for the day axis, descenders included — at 18 the tail of
 * the g in "Aug" was sliced off.
 */
const AXIS_HEIGHT = 22;

/**
 * The drawing surface: grid, baseline, marks, axis, and the cursor.
 *
 * ONE HIT SURFACE, NOT ONE PER COLUMN
 * A transparent rect over the whole plot, with the pointer resolved to a day by
 * `indexAtPointer`. Giving every column its own rect scales the DOM with the
 * window and — because it can only fire on enter — does nothing at all when a
 * finger is dragged across a phone. That failure is what made an earlier build
 * bolt a slider underneath to be usable on touch. Tracking `pointermove`
 * against one surface makes the chart itself the control.
 */
export function ChartPlot({
  width,
  days,
  series,
  shape,
  tone,
  domain,
  populated,
  cursor,
  onCursor,
  dayLabel,
}: {
  width: number;
  days: readonly string[];
  series: readonly Series[];
  shape: ChartShape;
  tone: ChartTone;
  domain: Domain;
  populated: boolean;
  cursor: number | null;
  onCursor: (index: number | null) => void;
  dayLabel: (day: string) => string;
}): React.ReactElement {
  const innerHeight = PLOT_HEIGHT - AXIS_HEIGHT;

  const xScale = useMemo(
    () => scaleBand({ domain: [...days], range: [0, width], padding: 0.28 }),
    [days, width],
  );
  const yScale = useMemo(
    () =>
      scaleLinear({
        domain: [domain.min, domain.max || 1],
        range: [innerHeight, 0],
        nice: true,
      }),
    [domain, innerHeight],
  );

  /*
   * Bars share a day's column only with bars that could overlap them, which
   * means bars on the same side of the axis. Grouping sales against refunds
   * halved both, and at thirty days that left a four-pixel sliver each.
   */
  const barScales = useMemo(() => {
    const build = (members: Series[]) =>
      scaleBand({
        domain: members.map((m) => m.key),
        range: [0, xScale.bandwidth()],
        padding: members.length > 1 ? 0.12 : 0,
      });
    const bars = shape === "bar" ? series : [];
    return {
      above: build(bars.filter((s) => !s.negative)),
      below: build(bars.filter((s) => s.negative)),
    };
  }, [series, shape, xScale]);

  const zeroY = yScale(0);

  function track(event: React.PointerEvent<SVGRectElement>): void {
    const point = localPoint(event);
    if (!point) return;
    onCursor(
      indexAtPointer(point.x, {
        offset: 0,
        step: xScale.step(),
        count: days.length,
      }),
    );
  }

  /*
   * A mouse leaving the plot means the reader has looked away, so the readout
   * goes back to window totals. A finger leaving it means they lifted it — the
   * day they tapped is the answer they asked for, and clearing it makes a tap
   * do nothing at all, which is exactly what it did before this check existed.
   */
  function release(event: React.PointerEvent<SVGRectElement>): void {
    if (event.pointerType === "touch") return;
    onCursor(null);
  }

  return (
    <svg
      width={width}
      height={PLOT_HEIGHT}
      className="overflow-visible"
      // Without this a drag on a touch screen scrolls the page instead of
      // scrubbing the chart, and pointermove stops arriving mid-gesture.
      style={{ touchAction: "pan-y" }}
    >
      {populated ? (
        <GridRows
          scale={yScale}
          width={width}
          numTicks={3}
          stroke="currentColor"
          className="text-ink-100"
        />
      ) : null}

      {/* The zero line: solid once something hangs below it, otherwise a hint. */}
      <line
        x1={0}
        x2={width}
        y1={zeroY}
        y2={zeroY}
        className="text-ink-300"
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray={domain.min < 0 ? undefined : "2 3"}
      />

      {/* The day under the cursor, marked behind everything it explains. */}
      {cursor !== null ? (
        <rect
          x={
            (xScale(days[cursor] ?? "") ?? 0) -
            (xScale.step() - xScale.bandwidth()) / 2
          }
          y={0}
          width={xScale.step()}
          height={innerHeight}
          className="text-ink-200"
          fill="currentColor"
          rx={3}
        />
      ) : null}

      {/*
        With no data there is nothing to plot. Drawing the series anyway put a
        confident line along the baseline of an empty shop's revenue card, which
        reads as a real measurement that happens to be flat.
      */}
      {populated ? (
        <ChartSeries
          series={series}
          days={days}
          shape={shape}
          tone={tone}
          xScale={xScale}
          yScale={yScale}
          barScales={barScales}
          cursor={cursor}
        />
      ) : null}

      {populated ? (
        <rect
          x={0}
          y={0}
          width={width}
          height={innerHeight}
          fill="transparent"
          onPointerMove={track}
          onPointerDown={track}
          onPointerLeave={release}
          onPointerCancel={() => onCursor(null)}
        />
      ) : null}

      {populated ? (
        <AxisBottom
          top={innerHeight}
          scale={xScale}
          numTicks={Math.min(5, days.length)}
          tickFormat={(d) => dayLabel(String(d))}
          stroke="transparent"
          tickStroke="transparent"
          /*
            The first and last labels are centred on columns against the edges,
            so half of each fell outside the card — "Jul 8" rendered as "ul 8".
            Anchor the ends inward and leave the rest centred.
          */
          tickLabelProps={(_, index, ticks) => ({
            fill: "currentColor",
            fontSize: 10,
            textAnchor:
              index === 0
                ? "start"
                : index === ticks.length - 1
                  ? "end"
                  : "middle",
            className: "text-ink-400",
          })}
        />
      ) : null}
    </svg>
  );
}
