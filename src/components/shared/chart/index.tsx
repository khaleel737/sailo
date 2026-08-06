"use client";

import { useId, useMemo, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { chartDomain, hasData, peak } from "@/lib/chart/domain";
import { snapshotAt, sumOf } from "@/lib/chart/cursor";
import type { ChartShape, ChartTone, Series } from "@/lib/chart/types";
import { formatMoney } from "@/lib/utils";
import { ChartHeader } from "./chart-header";
import { ChartPlot, PLOT_HEIGHT } from "./chart-plot";
import { ChartReadout } from "./chart-readout";
import { VariantSwitch } from "./variant-switch";

export type { Series };

/** Midday-safe: a bare date string parses as UTC and can slip a day westward. */
const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

export type ChartProps = {
  title: string;
  /** ISO days, one per column, shared by every series. */
  days: string[];
  series: Series[];
  /**
   * Which entity this measures, not which colour to use. Call sites cannot
   * invent a hue, which is how the same measure ended up indigo on one screen
   * and teal on another. See `lib/chart-palette.ts`.
   */
  tone: ChartTone;
  unit: "count" | "money";
  currency?: string;
  emptyLabel?: string;
  /**
   * The headline figure. Defaults to the sum of the first series; pass a
   * different series key when the total that matters is a derived one, such as
   * net revenue rather than gross.
   */
  totalKey?: string;
  /** Offer the reader bars-or-line. On by default; off for single-shape cards. */
  switchable?: boolean;
};

/**
 * A multi-series day chart: bars, lines, or both, over one shared domain.
 *
 * This file owns state and layout only. The arithmetic is in `lib/chart/`, the
 * marks are in `chart-series`, the frame is in `chart-plot`, and the figures
 * are in `chart-readout` — each testable or replaceable without the others.
 *
 * WHY VISX AND NOT RECHARTS
 * Measured, not assumed: these subpackages come to ~25kB gzipped, Recharts is
 * ~100kB, and `@visx/visx` — the convenience meta-package — is 167kB because it
 * re-exports all thirty-six. visx owns the scales and the path maths; what was
 * actually broken here stays in this repo, under test.
 *
 * ONE DOMAIN, ALWAYS CONTAINING ZERO
 * Every series shares a vertical scale. Drawn to their own maxima, a $5 refund
 * would sit at the same height as a $5,000 sale. Zero stays in the domain, so a
 * flat week between $90 and $100 reads as flat rather than as a collapse, and a
 * losing day has a baseline to hang from.
 *
 * SIGN IS POSITION, NOT COLOUR
 * Refunds hang below the zero line. `chart-palette.ts` establishes that the hue
 * space is full at two, so a second series steps the same hue in lightness —
 * the one axis that survives every kind of colour blindness — and is named in
 * the readout rather than left to a legend.
 */
export function Chart({
  title,
  days,
  series,
  tone,
  unit,
  currency = "USD",
  emptyLabel = "No activity yet",
  totalKey,
  switchable = true,
}: ChartProps) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [shape, setShape] = useState<ChartShape | null>(null);
  const switchId = useId();
  const cursorId = useId();

  const format = (value: number) =>
    unit === "money" ? formatMoney(value, currency) : value.toLocaleString();

  /*
   * The reader's choice overrides each series' default, except where a series
   * pins itself: net revenue is a running summary, and as bars beside the sales
   * it summarises it reads as a competing measure rather than their result.
   */
  const drawn = useMemo(
    () =>
      shape === null
        ? series
        : series.map((s) => (s.fixedShape ? s : { ...s, shape })),
    [series, shape],
  );

  const domain = useMemo(() => chartDomain(drawn), [drawn]);
  const populated = hasData(drawn);
  const top = useMemo(() => peak(drawn), [drawn]);

  const snapshot = cursor === null ? null : snapshotAt(cursor, days, series);
  const readoutValues = useMemo(
    () =>
      snapshot ? new Map(snapshot.values.map((v) => [v.key, v.value])) : null,
    [snapshot],
  );

  const headline = series.find((s) => s.key === totalKey) ?? series[0];
  const total = format(sumOf(headline));

  const offerSwitch =
    switchable && populated && series.some((s) => !s.fixedShape);
  const currentShape: ChartShape =
    shape ?? series.find((s) => !s.fixedShape)?.shape ?? "bar";

  return (
    <div>
      <ChartHeader
        title={title}
        total={total}
        peak={top}
        peakDay={top ? fmtDay(days[top.index] ?? "") : undefined}
        format={format}
        action={
          offerSwitch ? (
            <VariantSwitch
              name={switchId}
              value={currentShape}
              onChange={setShape}
            />
          ) : null
        }
      />

      {/*
        The focus ring belongs to the plot, not to the control that carries the
        keyboard. That control is the visually hidden range input below: it is
        never shown, because the chart itself is the thing to scrub — a pointer
        or a finger dragged across it moves the cursor directly. The input
        exists so the same reading is reachable by keyboard and announced by a
        screen reader, which a div with a keydown handler is not.
      */}
      <div
        className="focus-ring-within rounded"
        style={{ height: PLOT_HEIGHT }}
      >
        <ParentSize debounceTime={0}>
          {({ width }) =>
            width < 40 ? null : (
              <ChartPlot
                width={width}
                days={days}
                series={drawn}
                tone={tone}
                domain={domain}
                populated={populated}
                cursor={cursor}
                onCursor={setCursor}
                dayLabel={fmtDay}
              />
            )
          }
        </ParentSize>
      </div>

      {populated ? (
        <>
          <label htmlFor={cursorId} className="sr-only">
            {title} — read day by day
          </label>
          <input
            id={cursorId}
            type="range"
            min={0}
            max={Math.max(days.length - 1, 0)}
            step={1}
            value={cursor ?? 0}
            onChange={(event) => setCursor(Number(event.target.value))}
            onBlur={() => setCursor(null)}
            aria-valuetext={
              snapshot
                ? `${fmtDay(snapshot.day)}. ${snapshot.values
                    .map((v) => `${v.label} ${format(v.value)}`)
                    .join(", ")}`
                : `${days.length} days, ${total} in total`
            }
            className="sr-only"
          />
        </>
      ) : null}

      <ChartReadout
        series={series}
        tone={tone}
        values={readoutValues}
        periodLabel={snapshot ? fmtDay(snapshot.day) : `${days.length} days`}
        format={format}
      />

      {!populated ? (
        <p className="mt-2 text-center text-xs text-ink-400">{emptyLabel}</p>
      ) : null}
    </div>
  );
}
