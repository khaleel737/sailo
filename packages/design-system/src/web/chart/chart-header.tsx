import type { Peak } from "../../chart";

/**
 * The title, the headline figure, and the day worth calling out.
 *
 * The peak prints its value first and the word "peak" after it: an earlier
 * version had only the index to work with and rendered the label above a date
 * with no number anywhere near it — a label with nothing to label.
 */
export function ChartHeader({
  title,
  total,
  peak,
  peakDay,
  format,
  action,
}: {
  title: string;
  total: string;
  peak: Peak | null;
  peakDay: string | undefined;
  format: (value: number) => string;
  /** The variant switch, when the chart offers one. */
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1">
        <h2 dir="auto" className="text-sm font-medium text-ink-500">
          {title}
        </h2>
        <p className="mt-0.5 text-2xl font-semibold tabular-nums">{total}</p>
      </div>

      <div className="flex shrink-0 items-start gap-3">
        {peak && peakDay ? (
          <p className="text-right text-xs leading-tight text-ink-400">
            <span className="block font-semibold tabular-nums text-ink-900">
              {format(peak.value)}
            </span>
            peak {peak.label.toLowerCase()}
            <span className="block">{peakDay}</span>
          </p>
        ) : null}
        {action}
      </div>
    </div>
  );
}
