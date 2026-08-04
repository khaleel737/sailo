"use client";

import { useState } from "react";

type Point = { day: string; count: number };

const BAR = "#4f46e5"; // single series — validated for contrast on a light surface

/**
 * 14-day visit volume. One series, so the heading names it and no legend is
 * needed; only the peak is directly labelled, the rest surface on hover.
 */
export function VisitsChart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(...data.map((d) => d.count), 1);
  const peakIndex = data.reduce(
    (best, d, i) => (d.count > data[best].count ? i : best),
    0,
  );
  const total = data.reduce((sum, d) => sum + d.count, 0);

  const fmt = (day: string) =>
    new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-ink-500">
            Visits · last 14 days
          </h2>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">{total}</p>
        </div>
        {total > 0 ? (
          <p className="text-xs text-ink-400">
            Peak {data[peakIndex].count} on {fmt(data[peakIndex].day)}
          </p>
        ) : null}
      </div>

      <div className="relative">
        {/* Recessive baseline */}
        <div className="absolute inset-x-0 bottom-5 h-px bg-ink-200" />

        <div className="flex h-32 items-end gap-0.5">
          {data.map((point, i) => {
            const pct = (point.count / max) * 100;
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
                      {point.count}
                    </span>{" "}
                    <span className="opacity-70">· {fmt(point.day)}</span>
                  </div>
                ) : null}

                {i === peakIndex && point.count > 0 && !isHovered ? (
                  <span className="mb-1 text-center text-[10px] font-medium tabular-nums text-ink-500">
                    {point.count}
                  </span>
                ) : null}

                <div
                  className="w-full rounded-t transition-opacity"
                  style={{
                    height: `${Math.max(pct, point.count > 0 ? 4 : 1.5)}%`,
                    backgroundColor: point.count > 0 ? BAR : "#e6e6ea",
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

      {/* Table view so the data is never color- or hover-only. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-ink-400 transition hover:text-ink-600">
          View as table
        </summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-ink-400">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Visits</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.day} className="border-t border-ink-100">
                <td className="py-1 text-ink-600">{fmt(point.day)}</td>
                <td className="py-1 text-right tabular-nums text-ink-900">
                  {point.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
