import { chartColour } from "@/lib/chart-palette";
import type { ChartTone, Series } from "@/lib/chart";

/**
 * What the pointed-at day was worth, per series.
 *
 * This replaced a disclosure that opened a table of every day in the window.
 * Opening a fortnight of rows to answer "what happened on Tuesday" is a worse
 * answer than showing Tuesday, so the row is always present: window totals when
 * nothing is pointed at, the day's figures while reading.
 *
 * Fixed in place rather than floating beside the cursor. A tooltip that tracks
 * the pointer has to solve flipping at both edges, it covers the marks it is
 * describing, and on a touch screen it sits under the finger — while the reader
 * looks at the same spot each time regardless.
 */
export function ChartReadout({
  series,
  tone,
  values,
  periodLabel,
  format,
}: {
  series: readonly Series[];
  tone: ChartTone;
  /** Per-series figures for the pointed-at day, or null for window totals. */
  values: Map<string, number> | null;
  periodLabel: string;
  format: (value: number) => string;
}): React.ReactElement {
  return (
    <dl className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
      <dt className="sr-only">Period</dt>
      <dd className="text-xs font-medium tabular-nums text-ink-500">
        {periodLabel}
      </dd>

      {series.map((s, i) => (
        <div key={s.key} className="flex items-baseline gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 translate-y-px rounded-full"
            style={{ backgroundColor: chartColour(tone, s.depth ?? i) }}
          />
          <dt className="text-xs text-ink-400">{s.label}</dt>
          {/*
            A step larger than its label. This row is why the table went away —
            it is the number that moves as the reader scrubs, so it cannot be
            the smallest text on the card, separated from its own label by
            weight alone.
          */}
          <dd className="text-sm font-semibold tabular-nums text-ink-900">
            {format(
              values
                ? (values.get(s.key) ?? 0)
                : s.values.reduce((a, b) => a + b, 0),
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
