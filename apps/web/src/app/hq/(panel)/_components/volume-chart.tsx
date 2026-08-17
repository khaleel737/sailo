"use client";

import { useId, useMemo, useState } from "react";
import { Chart } from "@sailo/design-system/web/chart";
import type { VolumeSeries } from "@/lib/hq";
import { formatMoney } from "@sailo/core/currency";

/**
 * What sellers moved, in one currency at a time.
 *
 * WHY NOT ONE LINE PER CURRENCY
 * Because the y-axis is shared. Drawn together, ₦2,000,000 of Lagos orders
 * towers over €300 of Berlin ones and the chart says the Nigerian week was
 * six thousand times the German one. It wasn't; the two numbers aren't on the
 * same scale and no legend fixes that. `chart/index.tsx` refuses the same lie
 * for cents against counts, and this is that lie with a flag on it.
 *
 * WHY NOT ONE CONVERTED TOTAL
 * Because nothing here records an exchange rate. Converting at today's rate
 * would restate last month's volume every morning, and converting at all
 * without a rate captured at order time is a number we made up.
 *
 * So: the reader picks. What was a hardcoded "biggest currency wins, the rest
 * are a footnote" is now a switch that names every currency and what each one
 * came to — the breakdown and the control are the same object, and no currency
 * is a dead end.
 *
 * Client state rather than a search param, for the same reason the bars/line
 * switch is: every currency's series is already here, so a tab costs a
 * re-render. Through the URL it would cost a server round trip that re-runs
 * all nine of the overview's queries to redraw one card.
 */
export function VolumeChart({
  days,
  currencies,
}: {
  days: string[];
  currencies: VolumeSeries[];
}): React.ReactElement {
  const [chosen, setChosen] = useState<string | null>(null);
  const group = useId();

  // Biggest first out of the query, so the untouched default is the currency
  // most of the platform's business is in.
  const selected =
    currencies.find((entry) => entry.currency === chosen) ?? currencies[0];
  const currency = selected?.currency ?? "USD";

  // `Chart` memoises its arithmetic on the identity of `series`, so a literal
  // rebuilt every render would recompute the domain on each hover of the
  // scrubber. Keyed on the chosen currency, which is the only thing that
  // changes it.
  const series = useMemo(
    () => [
      {
        key: "volume",
        label: "Volume",
        values: selected?.values ?? days.map(() => 0),
      },
    ],
    [selected, days],
  );

  return (
    <>
      {currencies.length > 1 ? (
        <fieldset className="mb-4">
          <legend className="sr-only">Currency</legend>
          <div className="flex flex-wrap gap-1 rounded-xl bg-ink-100 p-1">
            {currencies.map((entry) => {
              const active = entry.currency === currency;
              return (
                <label
                  key={entry.currency}
                  className={`focus-within:ring-2 focus-within:ring-brand-500 flex cursor-pointer flex-col items-start rounded-lg px-2.5 py-1.5 transition-colors pointer-coarse:min-h-11 ${
                    active
                      ? "bg-white shadow-sm"
                      : "hover:bg-white/60"
                  }`}
                >
                  <input
                    type="radio"
                    name={group}
                    value={entry.currency}
                    checked={active}
                    onChange={() => setChosen(entry.currency)}
                    className="sr-only"
                  />
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wide ${
                      active ? "text-ink-500" : "text-ink-400"
                    }`}
                  >
                    {entry.currency}
                  </span>
                  <span
                    className={`tabular text-xs font-medium ${
                      active ? "text-ink-900" : "text-ink-500"
                    }`}
                  >
                    {formatMoney(entry.cents, entry.currency)}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <Chart
        title="Seller volume · last 30 days"
        defaultShape="line"
        days={days}
        series={series}
        tone="money"
        unit="money"
        currency={currency}
        emptyLabel="No volume in the last 30 days."
      />

      {currencies.length > 1 ? (
        <p className="mt-3 text-xs text-ink-400">
          Sellers price in their own currency, so each one is its own chart —
          added together they would make a figure that means nothing. The tabs
          are the split; pick one to draw it.
        </p>
      ) : null}
    </>
  );
}
