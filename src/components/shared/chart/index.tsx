"use client";

import { useId, useMemo, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { snapshotAt, sumOf } from "@/lib/chart/cursor";
import { chartDomain, hasData, peak } from "@/lib/chart/domain";
import { plotted } from "@/lib/chart/types";
import type { ChartShape, ChartTone, Series } from "@/lib/chart/types";
import { formatMoney } from "@/lib/utils";
import { ChartHeader } from "./chart-header";
import { ChartPlot, PLOT_HEIGHT } from "./chart-plot";
import { ChartReadout } from "./chart-readout";
import { VariantSwitch } from "./variant-switch";

export type { Series };

/**
  * Midday-safe: a bare date string parses as UTC and can slip a day westward.
  *
  * Every seller-facing chart passes a locale, so the axis of a German
  * seller's dashboard reads "5. Aug." rather than "Aug 5".
  */
function formatDay(day: string, locale: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

export type ChartProps = {
  title: string;
  /** ISO days, one per column, shared by every series. */
  days: readonly string[];
  series: readonly Series[];
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
   * The headline figure. Defaults to the sum of the first series; name a
   * different one when the total that matters is derived, as net revenue is.
   */
  totalKey?: string;
  /** What the chart draws until the reader says otherwise. */
  defaultShape?: ChartShape;
  /** Offer the reader bars-or-line. */
  switchable?: boolean;
  /**
   * Words for the bars-or-line control, including the legend a screen reader
   * announces. Omitted on the staff panel and the chart-regression page, which
   * are English by design.
   */
  shape?: { bar: string; line: string; legend: string };
  /**
   * Formats the day axis.
   *
   * Defaulted rather than left undefined: `undefined` means "whatever locale
   * this machine has", and `dev/charts` is a screenshot baseline whose whole
   * premise is that nothing varies between runs. The staff panel is English
   * by design and takes the same default.
   */
  locale?: string;
};

/**
 * A multi-series day chart. One shape at a time, over one shared domain.
 *
 * This file owns state and layout only. The arithmetic is in `lib/chart/`, the
 * marks are in `chart-series`, the frame is in `chart-plot`, and the figures
 * are in `chart-readout` — each testable or replaceable without the others.
 *
 * ONE SHAPE, NEVER TWO
 * An earlier version carried `shape` per series, so a revenue card drew sales
 * as bars and net as a line in the same frame. That reads as two charts
 * overlaid rather than one measure summarising another, and it is why net is
 * now reported rather than plotted: it is sales minus refunds, already on the
 * card twice over.
 *
 * WHY VISX AND NOT RECHARTS
 * Measured, not assumed: these subpackages come to ~25kB gzipped, Recharts is
 * ~100kB, and `@visx/visx` — the meta-package — is 167kB because it re-exports
 * all thirty-six.
 *
 * ONE DOMAIN, ALWAYS CONTAINING ZERO
 * Every drawn series shares a vertical scale. Drawn to their own maxima, a $5
 * refund would sit at the same height as a $5,000 sale. Zero stays in the
 * domain, so a flat week between $90 and $100 reads as flat rather than as a
 * collapse, and a losing day has a baseline to hang from.
 *
 * SIGN IS POSITION, NOT COLOUR
 * Refunds hang below the zero line. `chart-palette.ts` establishes the hue
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
  defaultShape = "bar",
  switchable = true,
  shape: shapeLabels,
  locale = "en-US",
}: ChartProps): React.ReactElement {
  const [cursor, setCursor] = useState<number | null>(null);
  const [chosenShape, setChosenShape] = useState<ChartShape | null>(null);
  const switchId = useId();
  const cursorId = useId();

  const shape = chosenShape ?? defaultShape;

  const format = (value: number): string =>
    unit === "money" ? formatMoney(value, currency) : value.toLocaleString();

  const drawn = useMemo(() => plotted(series), [series]);
  const domain = useMemo(() => chartDomain(series), [series]);
  const populated = hasData(series);
  const top = useMemo(() => peak(series), [series]);

  const snapshot = cursor === null ? null : snapshotAt(cursor, days, series);
  const readoutValues = useMemo(
    () =>
      snapshot ? new Map(snapshot.values.map((v) => [v.key, v.value])) : null,
    [snapshot],
  );

  const headline = series.find((s) => s.key === totalKey) ?? series[0];
  const total = format(sumOf(headline));
  // "1 days" was on the card for every shop whose window was a single day.
  const windowLabel = `${days.length} ${days.length === 1 ? "day" : "days"}`;

  return (
    <div>
      <ChartHeader
        title={title}
        total={total}
        peak={top}
        peakDay={top ? formatDay(days[top.index] ?? "", locale) : undefined}
        format={format}
        action={
          switchable && populated ? (
            <VariantSwitch
              name={switchId}
              value={shape}
              onChange={setChosenShape}
              {...(shapeLabels
                ? {
                    labels: { bar: shapeLabels.bar, line: shapeLabels.line },
                    legend: shapeLabels.legend,
                  }
                : {})}
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
                shape={shape}
                tone={tone}
                domain={domain}
                populated={populated}
                cursor={cursor}
                onCursor={setCursor}
                dayLabel={(day) => formatDay(day, locale)}
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
                ? `${formatDay(snapshot.day, locale)}. ${snapshot.values
                    .map((v) => `${v.label} ${format(v.value)}`)
                    .join(", ")}`
                : `${windowLabel}, ${total} in total`
            }
            className="sr-only"
          />
        </>
      ) : null}

      <ChartReadout
        series={series}
        tone={tone}
        values={readoutValues}
        periodLabel={snapshot ? formatDay(snapshot.day, locale) : windowLabel}
        format={format}
      />

      {populated ? null : (
        <p className="mt-2 text-center text-xs text-ink-400">{emptyLabel}</p>
      )}
    </div>
  );
}
