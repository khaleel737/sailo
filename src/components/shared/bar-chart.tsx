"use client";

import { useState } from "react";
import { CHART, type ChartTone } from "@/lib/chart-palette";
import { formatMoney } from "@/lib/utils";

export type Point = { day: string; value: number };

/** Midday-safe: a bare date string parses as UTC and can slip a day westward. */
const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

/**
 * A 14-day single-series bar chart. One series per chart, so the heading names
 * it and no legend is needed; only the peak is directly labelled and the rest
 * surface on hover. A table view keeps the data available without hover.
 *
 * Formatting is described by props rather than a callback — a server component
 * can't hand a function to a client one.
 */
export function BarChart({
  title,
  data,
  tone,
  unit,
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
  currency?: string;
  emptyLabel?: string;
  /*
   * Passed in rather than read from a dictionary: this chart is shared with
   * /hq, which is English-only and sits outside the admin's i18n provider.
   */
  tableLabel?: string;
}) {
  const colour = CHART[tone];
  const [hover, setHover] = useState<number | null>(null);

  const format = (value: number) =>
    unit === "money" ? formatMoney(value, currency) : value.toLocaleString();
  const total = format(data.reduce((sum, d) => sum + d.value, 0));

  const max = Math.max(...data.map((d) => d.value), 1);
  const peakIndex = data.reduce(
    (best, d, i) => (d.value > (data[best]?.value ?? -Infinity) ? i : best),
    0,
  );
  // Bound once: "there is data" and "the peak row exists" are the same fact,
  // and splitting them let the render read a row the guard didn't prove.
  const peak = data.some((d) => d.value > 0) ? data[peakIndex] : undefined;

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 dir="auto" className="text-sm font-medium text-ink-500">{title}</h2>
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
        Each bar sits in a track with a DEFINITE height (h-28). A percentage
        height against an auto-height parent resolves to nothing, which
        silently collapses every bar to zero.
      */}
      <div className="flex items-end gap-0.5 border-b border-ink-200">
        {data.map((point, i) => {
          const pct = (point.value / max) * 100;
          const isHovered = hover === i;

          return (
            <div
              key={point.day}
              className="group relative flex flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {isHovered ? (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-xs text-white shadow-lg">
                  <span className="font-semibold tabular-nums">
                    {format(point.value)}
                  </span>{" "}
                  <span className="opacity-70">· {fmtDay(point.day)}</span>
                </div>
              ) : null}

              {i === peakIndex && point.value > 0 && !isHovered ? (
                <span className="mb-1 whitespace-nowrap text-[10px] font-medium tabular-nums text-ink-500">
                  {format(point.value)}
                </span>
              ) : null}

              <div className="flex h-28 w-full items-end">
                <div
                  className="w-full rounded-t transition-opacity"
                  style={{
                    height: `${Math.max(pct, point.value > 0 ? 4 : 1.5)}%`,
                    backgroundColor: point.value > 0 ? colour : "#e6e6ea",
                    opacity: hover === null || isHovered ? 1 : 0.45,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-0.5">
        {data.map((point, i) => (
          <span
            key={point.day}
            className="flex-1 text-center text-[10px] text-ink-400"
          >
            {i === 0 || i === data.length - 1
              ? new Date(`${point.day}T00:00:00Z`).getUTCDate()
              : ""}
          </span>
        ))}
      </div>

      {!peak ? (
        <p className="mt-2 text-center text-xs text-ink-400">{emptyLabel}</p>
      ) : null}

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
