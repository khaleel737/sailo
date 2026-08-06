"use client";

import { useId, useMemo, useState } from "react";
import { AxisBottom } from "@visx/axis";
import { curveMonotoneX } from "@visx/curve";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar, LinePath } from "@visx/shape";
import { chartColour, type ChartTone } from "@/lib/chart-palette";
import {
  chartDomain,
  hasData,
  peakIndex,
  type Series,
} from "@/lib/chart-scale";
import { formatMoney } from "@/lib/utils";

export type { Series };

/** Midday-safe: a bare date string parses as UTC and can slip a day westward. */
const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

const PLOT_HEIGHT = 132;
/** Room under the plot for the day axis. */
const AXIS_HEIGHT = 18;

type ChartProps = {
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
};

/**
 * A multi-series day chart: bars, lines, or both, over one shared domain.
 *
 * WHY VISX AND NOT RECHARTS
 * Measured, not assumed. The subpackages this imports come to ~25kB gzipped;
 * Recharts is ~100kB, and `@visx/visx` — the convenience meta-package — is
 * 167kB, because it re-exports all thirty-six. visx is primitives: it owns the
 * scales and the path maths and nothing else, which leaves the parts that were
 * actually broken here (what the domain is, what a refund means, what a phone
 * can read) in this repo, under test.
 *
 * ONE DOMAIN, ALWAYS CONTAINING ZERO
 * Every series shares a vertical scale. Drawn to their own maxima, a $5 refund
 * would sit at the same height as a $5,000 sale. And zero is always in the
 * domain, so a flat week between $90 and $100 reads as flat rather than as a
 * collapse, and a losing day has a baseline to hang from. See `chart-scale.ts`.
 *
 * SIGN IS POSITION, NOT COLOUR
 * Refunds hang below the zero line. `chart-palette.ts` establishes that the hue
 * space is full at two, so a second series steps the same hue in lightness —
 * the one axis that survives every kind of colour blindness — and is named in
 * the readout rather than left to a legend.
 *
 * ONLY THE PLOT IS MEASURED
 * `ParentSize` renders nothing until it has a width, so wrapping the whole card
 * in it would leave the title and the totals missing on first paint and drop
 * them in afterwards. The text is plain server-rendered markup; only the svg
 * waits, inside a box that already reserves its height.
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
}: ChartProps) {
  const [cursor, setCursor] = useState<number | null>(null);
  const cursorId = useId();

  const format = (value: number) =>
    unit === "money" ? formatMoney(value, currency) : value.toLocaleString();

  const domain = useMemo(() => chartDomain(series), [series]);
  const populated = hasData(series);
  const peakAt = peakIndex(series);

  const headline = series.find((s) => s.key === totalKey) ?? series[0];
  const total = format((headline?.values ?? []).reduce((a, b) => a + b, 0));
  const readoutDay = cursor === null ? null : days[cursor];

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 dir="auto" className="text-sm font-medium text-ink-500">
            {title}
          </h2>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">{total}</p>
        </div>
        {populated ? (
          <p className="text-right text-xs text-ink-400">
            Peak
            <br />
            {fmtDay(days[peakAt] ?? "")}
          </p>
        ) : null}
      </div>

      <div style={{ height: PLOT_HEIGHT }}>
        <ParentSize debounceTime={0}>
          {({ width }) =>
            width < 40 ? null : (
              <Plot
                width={width}
                days={days}
                series={series}
                tone={tone}
                domain={domain}
                cursor={cursor}
                onCursor={setCursor}
              />
            )
          }
        </ParentSize>
      </div>

      {/*
        Keyboard and screen-reader access through a real control, rather than a
        div wearing tabIndex and a keydown handler — which is what this was, and
        what the a11y linter correctly rejected. A range input already *is* a
        cursor over an ordered set: it takes focus, arrow keys and Home/End work
        without being reimplemented, and assistive technology announces each
        step from `aria-valuetext` instead of reading a bare number. It is
        visually hidden because the plot and the readout below are its display —
        both move with it, so a sighted keyboard user watches the figures change
        even though the control itself is off-screen.
      */}
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
              readoutDay
                ? `${fmtDay(readoutDay)}. ${series
                    .map(
                      (s) => `${s.label} ${format(s.values[cursor ?? 0] ?? 0)}`,
                    )
                    .join(", ")}`
                : `${days.length} days, ${total} in total`
            }
            className="sr-only"
          />
        </>
      ) : null}

      {/*
        The readout, in place of the table that used to hide behind a
        disclosure. Opening a fortnight of rows to answer "what happened on
        Tuesday" is a worse answer than putting Tuesday here: always visible,
        every series named, no interaction needed on a phone. It shows window
        totals at rest and the hovered day while reading.
      */}
      <dl className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-ink-100 pt-2">
        <dt className="sr-only">Period</dt>
        <dd className="text-xs font-medium tabular-nums text-ink-600">
          {readoutDay ? fmtDay(readoutDay) : `${days.length} days`}
        </dd>
        {series.map((s, i) => (
          <div key={s.key} className="flex items-baseline gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 translate-y-px rounded-full"
              style={{ backgroundColor: chartColour(tone, i) }}
            />
            <dt className="text-xs text-ink-400">{s.label}</dt>
            <dd className="text-xs font-semibold tabular-nums text-ink-900">
              {format(
                cursor === null
                  ? s.values.reduce((a, b) => a + b, 0)
                  : (s.values[cursor] ?? 0),
              )}
            </dd>
          </div>
        ))}
      </dl>

      {!populated ? (
        <p className="mt-2 text-center text-xs text-ink-400">{emptyLabel}</p>
      ) : null}

      {/* Announced as the cursor moves, so the readout is not sighted-only. */}
      <p className="sr-only" aria-live="polite">
        {readoutDay
          ? `${fmtDay(readoutDay)}. ${series
              .map((s) => `${s.label} ${format(s.values[cursor ?? 0] ?? 0)}`)
              .join(", ")}`
          : ""}
      </p>
    </div>
  );
}

function Plot({
  width,
  days,
  series,
  tone,
  domain,
  cursor,
  onCursor,
}: {
  width: number;
  days: string[];
  series: Series[];
  tone: ChartTone;
  domain: { min: number; max: number };
  cursor: number | null;
  onCursor: (index: number | null) => void;
}) {
  const innerHeight = PLOT_HEIGHT - AXIS_HEIGHT;

  const xScale = useMemo(
    () => scaleBand({ domain: days, range: [0, width], padding: 0.28 }),
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

  // Bar series share each day's column, side by side. With one series that is
  // the whole column; with two it is a pair, which is how sales and refunds
  // stay legible on the same day rather than one hiding the other.
  const barScale = useMemo(
    () =>
      scaleBand({
        domain: series.filter((s) => s.shape === "bar").map((s) => s.key),
        range: [0, xScale.bandwidth()],
        padding: 0.12,
      }),
    [series, xScale],
  );

  const zeroY = yScale(0);
  const centre = (i: number) =>
    (xScale(days[i] ?? "") ?? 0) + xScale.bandwidth() / 2;
  /** A series' value for a day, flipped negative when it is money leaving. */
  const valueAt = (s: Series, i: number) => {
    const raw = s.values[i] ?? 0;
    return s.negative ? -Math.abs(raw) : raw;
  };

  return (
    <svg
      width={width}
      height={PLOT_HEIGHT}
      className="overflow-visible"
      onPointerLeave={() => onCursor(null)}
    >
      <GridRows
        scale={yScale}
        width={width}
        numTicks={3}
        stroke="currentColor"
        className="text-ink-100"
      />

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
          x={xScale(days[cursor] ?? "") ?? 0}
          y={0}
          width={xScale.bandwidth()}
          height={innerHeight}
          className="text-ink-100"
          fill="currentColor"
          rx={3}
        />
      ) : null}

      {series.map((s, seriesIndex) => {
        const colour = chartColour(tone, seriesIndex);

        if (s.shape === "line") {
          return (
            <Group key={s.key}>
              <LinePath
                data={days.map((_, i) => i)}
                x={centre}
                y={(i) => yScale(valueAt(s, i))}
                stroke={colour}
                strokeWidth={2}
                strokeLinecap="round"
                curve={curveMonotoneX}
                fill="none"
              />
              {cursor !== null ? (
                <circle
                  cx={centre(cursor)}
                  cy={yScale(valueAt(s, cursor))}
                  r={3.5}
                  fill={colour}
                  stroke="white"
                  strokeWidth={1.5}
                />
              ) : null}
            </Group>
          );
        }

        return (
          <Group key={s.key}>
            {days.map((day, i) => {
              const value = valueAt(s, i);
              // A real value must never round away to an invisible sliver; a
              // zero day still draws a tick so the column reads as present.
              const height = Math.max(
                Math.abs(yScale(value) - zeroY),
                value === 0 ? 1 : 2,
              );

              return (
                <Bar
                  key={day}
                  x={(xScale(day) ?? 0) + (barScale(s.key) ?? 0)}
                  y={value >= 0 ? yScale(value) : zeroY}
                  width={barScale.bandwidth()}
                  height={height}
                  rx={2}
                  fill={value === 0 ? "#e6e6ea" : colour}
                  opacity={cursor === null || cursor === i ? 1 : 0.45}
                />
              );
            })}
          </Group>
        );
      })}

      {/* Full-height hit zones: the whole column answers, not just the bar. */}
      {days.map((day, i) => (
        <rect
          key={day}
          x={xScale(day) ?? 0}
          y={0}
          width={xScale.step()}
          height={innerHeight}
          fill="transparent"
          onPointerEnter={() => onCursor(i)}
          onPointerDown={() => onCursor(i)}
        />
      ))}

      <AxisBottom
        top={innerHeight}
        scale={xScale}
        numTicks={Math.min(5, days.length)}
        tickFormat={(d) => fmtDay(String(d))}
        stroke="transparent"
        tickStroke="transparent"
        tickLabelProps={() => ({
          fill: "currentColor",
          fontSize: 10,
          textAnchor: "middle",
          className: "text-ink-400",
        })}
      />
    </svg>
  );
}
