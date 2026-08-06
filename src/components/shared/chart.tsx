"use client";

import { useId, useState } from "react";
import { CHART, type ChartTone } from "@/lib/chart-palette";
import { chartScale, peakIndex, type Point } from "@/lib/chart-scale";
import { formatMoney } from "@/lib/utils";

export type { Point };

/** Midday-safe: a bare date string parses as UTC and can slip a day westward. */
const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

/**
 * A single-series day chart, drawn as bars or as a line.
 *
 * One series per chart, so the heading names it and no legend is needed; only
 * the peak is directly labelled and the rest surface on hover. A table view
 * keeps the data available without hover.
 *
 * Formatting is described by props rather than a callback — a server component
 * can't hand a function to a client one.
 *
 * WHY THIS DRAWS ITSELF
 * Recharts is ~100kB gzipped of client JavaScript. This is a single series of
 * a few dozen points with no zoom, no brush, no second axis and no stacking,
 * and it ships on the dashboard every seller sees. Fifty lines of arithmetic
 * is the cheaper trade until one of those features is actually wanted.
 *
 * NEGATIVE VALUES
 * Revenue goes negative on a day whose refunds outweigh its sales. The chart
 * this replaced clamped every such day to a 1.5% grey stub, which is exactly
 * what a zero day looked like — so a day that lost $500 and a day that did
 * nothing were indistinguishable. Sign is carried by position: the zero line
 * is drawn wherever the data puts it, and negative days hang below it in the
 * same hue. Not by colour, which `lib/chart-palette.ts` explains is full.
 */
export function Chart({
  title,
  data,
  tone,
  unit,
  variant = "bar",
  currency = "USD",
  emptyLabel = "No activity yet",
  tableLabel = "View as table",
}: {
  title: string;
  data: Point[];
  /**
   * Which entity this measures, not which colour to use. Call sites cannot
   * invent a hue, which is how the same measure ended up indigo on one screen
   * and teal on another. See `lib/chart-palette.ts`.
   */
  tone: ChartTone;
  unit: "count" | "money";
  /** Bars for discrete daily totals, a line for shape over a longer window. */
  variant?: "bar" | "line";
  currency?: string;
  emptyLabel?: string;
  /*
   * Passed in rather than read from a dictionary: this chart is shared with
   * /hq, which is English-only and sits outside the admin's i18n provider.
   */
  tableLabel?: string;
}) {
  const colour = CHART[tone];
  const [cursor, setCursor] = useState<number | null>(null);
  const gradientId = useId();

  const format = (value: number) =>
    unit === "money" ? formatMoney(value, currency) : value.toLocaleString();
  const total = format(data.reduce((sum, d) => sum + d.value, 0));

  // The positioning arithmetic lives in `lib/chart-scale.ts`, where it is
  // tested. A bar at the wrong height still looks like a chart.
  const { lo, zeroY, y, x, bar } = chartScale(data);
  const peakAt = peakIndex(data);

  // Bound once: "there is data" and "the peak row exists" are the same fact,
  // and splitting them let the render read a row the guard didn't prove.
  const peak = data.some((d) => d.value !== 0) ? data[peakAt] : undefined;
  const active = cursor === null ? null : data[cursor];

  // Label the ends and a couple of interior days; one label per column is
  // unreadable past about a fortnight.
  const labelStep = Math.max(1, Math.ceil(data.length / 4));

  function onKeyDown(event: React.KeyboardEvent) {
    const keys: Record<string, number> = {
      ArrowRight: (cursor ?? -1) + 1,
      ArrowLeft: (cursor ?? data.length) - 1,
      Home: 0,
      End: data.length - 1,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setCursor(Math.min(Math.max(next, 0), data.length - 1));
  }

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 dir="auto" className="text-sm font-medium text-ink-500">
            {title}
          </h2>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">{total}</p>
        </div>
        {peak ? (
          <p className="text-right text-xs text-ink-400">
            Peak {format(peak.value)}
            <br />
            {fmtDay(peak.day)}
          </p>
        ) : null}
      </div>

      {/*
        A single tab stop with arrow-key navigation, rather than one per column:
        thirty tab stops to cross one card is worse than none. Pointer events
        rather than mouse events so a tap on a phone reads a value — this chart
        is on the dashboard of a product whose sellers are mostly on phones, and
        hover alone left them with nothing but the peak.
      */}
      <div
        role="group"
        tabIndex={data.length > 0 ? 0 : -1}
        aria-label={`${title}. ${total} in total.${
          peak ? ` Peak ${format(peak.value)} on ${fmtDay(peak.day)}.` : ""
        } Use arrow keys to read each day.`}
        onKeyDown={onKeyDown}
        onBlur={() => setCursor(null)}
        onPointerLeave={() => setCursor(null)}
        className="focus-ring relative h-28 rounded"
      >
        {/* The zero line, drawn only when something actually sits below it. */}
        {lo < 0 ? (
          <div
            className="absolute inset-x-0 border-t border-dashed border-ink-300"
            style={{ top: `${zeroY}%` }}
          />
        ) : null}

        {variant === "line" ? (
          <svg
            className="absolute inset-0 h-full w-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colour} stopOpacity="0.22" />
                <stop offset="100%" stopColor={colour} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {data.length > 1 ? (
              <path
                d={`M ${x(0)} ${zeroY} ${data
                  .map((d, i) => `L ${x(i)} ${y(d.value)}`)
                  .join(" ")} L ${x(data.length - 1)} ${zeroY} Z`}
                fill={`url(#${gradientId})`}
              />
            ) : null}
            <polyline
              points={data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ")}
              fill="none"
              stroke={colour}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              /*
               * The viewBox is stretched to the card, so without this the
               * stroke is squashed to a hairline horizontally and fat
               * vertically. Circles would distort the same way, which is why
               * the markers below are HTML rather than <circle>.
               */
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}

        <div className="absolute inset-0 flex items-stretch gap-0.5">
          {data.map((point, i) => {
            const isActive = cursor === i;
            const isPeak = i === peakAt && point.value !== 0;
            const { top, height } = bar(point.value);

            return (
              <div
                key={point.day}
                className="relative flex-1"
                onPointerEnter={() => setCursor(i)}
                onPointerDown={() => setCursor(i)}
              >
                {variant === "bar" ? (
                  <div
                    className="absolute inset-x-0 rounded-[2px] transition-opacity"
                    style={{
                      top: `${top}%`,
                      height: `${height}%`,
                      backgroundColor: point.value === 0 ? "#e6e6ea" : colour,
                      opacity: cursor === null || isActive ? 1 : 0.45,
                    }}
                  />
                ) : (
                  <div
                    className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white transition-opacity"
                    style={{
                      left: `${x(i)}%`,
                      top: `${y(point.value)}%`,
                      backgroundColor: colour,
                      opacity: isActive || isPeak ? 1 : 0,
                    }}
                  />
                )}

                {isActive ? (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-xs text-white shadow-lg">
                    <span className="font-semibold tabular-nums">
                      {format(point.value)}
                    </span>{" "}
                    <span className="opacity-70">· {fmtDay(point.day)}</span>
                  </div>
                ) : null}

                {isPeak && cursor === null ? (
                  <span
                    className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap text-[10px] font-medium tabular-nums text-ink-500"
                    style={{ top: `${y(point.value)}%` }}
                  >
                    {format(point.value)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-1.5 flex gap-0.5 border-t border-ink-200 pt-1.5">
        {data.map((point, i) => (
          <span
            key={point.day}
            className="flex-1 text-center text-[10px] text-ink-400"
          >
            {i === 0 || i === data.length - 1 || i % labelStep === 0
              ? new Date(`${point.day}T00:00:00Z`).getUTCDate()
              : ""}
          </span>
        ))}
      </div>

      {!peak ? (
        <p className="mt-2 text-center text-xs text-ink-400">{emptyLabel}</p>
      ) : null}

      {/* Announced for screen readers as the cursor moves. */}
      <p className="sr-only" aria-live="polite">
        {active ? `${fmtDay(active.day)}: ${format(active.value)}` : ""}
      </p>

      <details className="mt-3">
        <summary className="focus-ring inline-flex cursor-pointer items-center rounded text-xs text-ink-400 transition hover:text-ink-600 pointer-coarse:min-h-11">
          {tableLabel}
        </summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-ink-400">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">{title}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.day} className="border-t border-ink-100">
                <td className="py-1 text-ink-600">{fmtDay(point.day)}</td>
                <td className="py-1 text-right tabular-nums text-ink-900">
                  {format(point.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
