"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/utils";

export type Point = { day: string; value: number };

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
  colour,
  unit,
  currency = "USD",
  emptyLabel = "No activity yet",
}: {
  title: string;
  data: Point[];
  /** Validated for contrast against the light admin surface. */
  colour: string;
  unit: "count" | "money";
  currency?: string;
  emptyLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const format = (value: number) =>
    unit === "money" ? formatMoney(value, currency) : value.toLocaleString();
  const total = format(data.reduce((sum, d) => sum + d.value, 0));

  const max = Math.max(...data.map((d) => d.value), 1);
  const peakIndex = data.reduce(
    (best, d, i) => (d.value > data[best].value ? i : best),
    0,
  );
  const hasData = data.some((d) => d.value > 0);

  const fmtDay = (day: string) =>
    new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-ink-500">{title}</h2>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">{total}</p>
        </div>
        {hasData ? (
          <p className="text-right text-xs text-ink-400">
            Peak {format(data[peakIndex].value)}
            <br />
            {fmtDay(data[peakIndex].day)}
          </p>
        ) : null}
      </div>

      <div className="relative">
        <div className="absolute inset-x-0 bottom-5 h-px bg-ink-200" />

        <div className="flex h-32 items-end gap-0.5">
          {data.map((point, i) => {
            const pct = (point.value / max) * 100;
            const isHovered = hover === i;

            return (
              <div
                key={point.day}
                className="group relative flex flex-1 flex-col justify-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                {isHovered ? (
                  <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-xs text-white shadow-lg">
                    <span className="font-semibold tabular-nums">
                      {format(point.value)}
                    </span>{" "}
                    <span className="opacity-70">· {fmtDay(point.day)}</span>
                  </div>
                ) : null}

                {i === peakIndex && point.value > 0 && !isHovered ? (
                  <span className="mb-1 truncate text-center text-[10px] font-medium tabular-nums text-ink-500">
                    {format(point.value)}
                  </span>
                ) : null}

                <div
                  className="w-full rounded-t transition-opacity"
                  style={{
                    height: `${Math.max(pct, point.value > 0 ? 4 : 1.5)}%`,
                    backgroundColor: point.value > 0 ? colour : "#e6e6ea",
                    opacity: hover === null || isHovered ? 1 : 0.45,
                  }}
                />

                <span className="mt-1.5 h-4 text-center text-[10px] text-ink-400">
                  {i === 0 || i === data.length - 1
                    ? new Date(`${point.day}T00:00:00`).getDate()
                    : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {!hasData ? (
        <p className="mt-2 text-center text-xs text-ink-400">{emptyLabel}</p>
      ) : null}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-ink-400 transition hover:text-ink-600">
          View as table
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
