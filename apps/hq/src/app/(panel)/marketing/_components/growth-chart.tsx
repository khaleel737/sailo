import { formatDay } from "@/lib/format";

/**
 * Thirty days of signups, as bars.
 *
 * A chart and not a number, because the number is already above it and what a
 * number cannot say is *shape*: a list that grew four hundred on the day one
 * article was posted and eleven since is a completely different business from
 * one that grows fifteen a day, and both report the same monthly total.
 *
 * Drawn in HTML rather than with the chart library the revenue pages use. This
 * is thirty bars with no axes, no tooltip and no interaction — a charting
 * runtime for that is a client bundle and a hydration boundary bought for
 * nothing, and this page is otherwise entirely server-rendered.
 */
export function GrowthChart({
  days,
  data,
}: {
  /** How many days the axis covers, so a quiet day is a gap rather than absent. */
  days: number;
  data: { day: string; count: number }[];
}) {
  const byDay = new Map(data.map((row) => [row.day, row.count]));

  /*
   * The axis is built here from the range asked for, not from the rows.
   *
   * The query returns only days that had signups — correct, because inventing
   * zero rows in SQL would mean the query and the chart both holding an
   * opinion about what a day is. The chart is the one that knows, because it
   * is the one drawing the axis.
   */
  const today = new Date();
  const axis = Array.from({ length: days }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (days - 1 - i));
    const key = date.toISOString().slice(0, 10);
    return { key, count: byDay.get(key) ?? 0 };
  });

  // A flat list of zeroes would divide by zero and draw full-height bars.
  const peak = Math.max(1, ...axis.map((d) => d.count));

  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`Signups over the last ${days} days`}>
        {axis.map((day) => (
          <div
            key={day.key}
            // The title is the accessible detail: the bars themselves are one
            // image to a screen reader, and a per-bar label would read out
            // thirty numbers nobody asked for.
            title={`${formatDay(day.key)} · ${day.count}`}
            className="flex-1 rounded-t-sm bg-ink-900/80"
            style={{
              // A day with one signup still gets a visible bar; a day with
              // none gets a hairline, which reads as "nothing" rather than as
              // a rendering gap.
              height: day.count === 0 ? "2px" : `${Math.max(6, (day.count / peak) * 96)}px`,
              opacity: day.count === 0 ? 0.15 : 1,
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-ink-400">
        <span>{formatDay(axis[0]?.key ?? "")}</span>
        <span className="tabular">peak {peak}</span>
        <span>{formatDay(axis.at(-1)?.key ?? "")}</span>
      </div>
    </div>
  );
}
