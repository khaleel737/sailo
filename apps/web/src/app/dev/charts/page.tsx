import { notFound } from "next/navigation";
import { Chart } from "@sailo/design-system/web/chart";
import { Card, Sparkline, Stat } from "@sailo/design-system/web";
import { CHART, CHART_STEPS } from "@sailo/design-system/chart/palette";
import type { Series } from "@sailo/design-system/chart";

/* Not yet converted — see the note in `next.config.ts`. */
export const instant = false;


/**
 * The chart, under every dataset that has ever broken it.
 *
 * WHY THIS ROUTE EXISTS
 * Every rendering fault in this component was found by looking at it, not by
 * reading it: bars and a line in one frame, an axis label clipped to "ul 8", a
 * one-day window drawing a slab half the width of its card, a line along the
 * baseline of a shop with no sales, "1 days". None of those fail a type check
 * or a unit test. `e2e/charts.spec.ts` photographs this page and compares it
 * against a committed baseline, so the next one fails a build instead of
 * reaching a seller.
 *
 * DETERMINISM IS THE WHOLE POINT
 * A screenshot test is worthless if the picture moves on its own. Nothing here
 * may vary between runs, which means: dates are hard-coded rather than derived
 * from today, values come from a seeded generator rather than `Math.random`,
 * and no case depends on the machine's locale or clock.
 *
 * Never reachable in production — `next dev` serves it, a deployment 404s it.
 */

/** Numerical Recipes LCG. Seeded, so the same page renders forever. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Fixed calendar days. Never `new Date()` — that would move the baseline. */
function days(count: number, startDay = 1): string[] {
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(2026, 6, startDay + i)).toISOString().slice(0, 10),
  );
}

function revenue(sales: number[], refunds: number[]): Series[] {
  return [
    { key: "sales", label: "Sales", depth: 1, values: sales },
    { key: "refunds", label: "Refunds", negative: true, depth: 2, values: refunds },
    {
      key: "net",
      label: "Net",
      depth: 0,
      readoutOnly: true,
      values: sales.map((s, i) => s - (refunds[i] ?? 0)),
    },
  ];
}

const next = rng(42);
const D30 = days(30);
const STEADY = Array.from({ length: 30 }, () => Math.round(next() * 60_000));
const REFUNDS = Array.from({ length: 30 }, (_, i) =>
  i === 11 ? 88_000 : i % 9 === 0 ? Math.round(next() * 9_000) : 0,
);
const VIEWS = Array.from({ length: 30 }, () => Math.round(next() * 340) + 10);

/** Each case is photographed on its own, so a diff names the shape that broke. */
const CASES: { id: string; title: string; node: React.ReactNode }[] = [
  {
    id: "steady",
    title: "Revenue · steady trade",
    node: (
      <Chart
        title="Revenue · steady trade"
        days={D30}
        series={revenue(STEADY, REFUNDS)}
        totalKey="net"
        tone="money"
        unit="money"
        currency="USD"
      />
    ),
  },
  {
    id: "traffic",
    title: "Visits · two lines",
    node: (
      <Chart
        title="Visits · 30 days"
        days={D30}
        defaultShape="line"
        series={[
          { key: "views", label: "Views", values: VIEWS },
          {
            key: "visitors",
            label: "Visitors",
            values: VIEWS.map((v) => Math.round(v * 0.62)),
          },
        ]}
        tone="activity"
        unit="count"
      />
    ),
  },
  {
    id: "refund-spike",
    title: "Revenue · one catastrophic refund",
    node: (
      <Chart
        title="Revenue · one catastrophic refund"
        days={D30}
        series={revenue(
          STEADY.map((v) => Math.round(v / 6)),
          REFUNDS,
        )}
        totalKey="net"
        tone="money"
        unit="money"
        currency="USD"
      />
    ),
  },
  {
    id: "refunds-only",
    title: "Revenue · refunds only",
    node: (
      <Chart
        title="Revenue · refunds only"
        days={D30}
        series={revenue(
          D30.map(() => 0),
          D30.map((_, i) => (i % 3 === 0 ? 12_000 : 0)),
        )}
        totalKey="net"
        tone="money"
        unit="money"
        currency="USD"
      />
    ),
  },
  {
    id: "cent-beside-fortune",
    title: "Revenue · a cent beside a fortune",
    node: (
      <Chart
        title="Revenue · a cent beside a fortune"
        days={D30}
        series={revenue(
          D30.map((_, i) => (i === 2 ? 1 : i === 20 ? 5_000_000 : 0)),
          D30.map(() => 0),
        )}
        totalKey="net"
        tone="money"
        unit="money"
        currency="USD"
      />
    ),
  },
  {
    id: "empty",
    title: "Revenue · a brand new shop",
    node: (
      <Chart
        title="Revenue · 30 days"
        days={D30}
        series={revenue(
          D30.map(() => 0),
          D30.map(() => 0),
        )}
        totalKey="net"
        tone="money"
        unit="money"
        currency="USD"
        emptyLabel="No sales yet — share your link to get your first order."
      />
    ),
  },
  {
    id: "single-day",
    title: "Revenue · a single day",
    node: (
      <Chart
        title="Revenue · 1 day"
        days={days(1)}
        series={revenue([24_900], [0])}
        totalKey="net"
        tone="money"
        unit="money"
        currency="USD"
      />
    ),
  },
  {
    id: "flat-week",
    title: "Revenue · a flat week",
    node: (
      <Chart
        title="Revenue · 7 days"
        days={days(7)}
        series={revenue(Array(7).fill(9_900), Array(7).fill(0))}
        totalKey="net"
        tone="money"
        unit="money"
        currency="USD"
      />
    ),
  },
  {
    id: "year",
    title: "Revenue · a full year",
    node: (
      <Chart
        title="Revenue · 365 days"
        days={days(365)}
        series={revenue(
          Array.from({ length: 365 }, (_, i) => Math.round(20_000 + 15_000 * Math.sin(i / 12))),
          Array.from({ length: 365 }, (_, i) => (i % 40 === 0 ? 30_000 : 0)),
        )}
        totalKey="net"
        tone="money"
        unit="money"
        currency="USD"
      />
    ),
  },
  {
    /*
     * The tile strip's sparklines, in the four states a real shop produces:
     * a busy series, a sparse one that is mostly zeros, a dead-flat zero
     * line, and a net-revenue line a refund pushes below nothing. Built from
     * the arrays above, so no new randomness moves the other baselines.
     */
    id: "sparklines",
    title: "Stat tiles · sparklines",
    node: (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Visits"
          value="1,284"
          chart={<Sparkline values={VIEWS} color={CHART.activity} />}
        />
        <Stat
          label="Unique visitors"
          value="9"
          chart={
            <Sparkline
              values={Array.from({ length: 30 }, (_, i) =>
                i % 7 === 0 ? 2 : i % 11 === 0 ? 1 : 0,
              )}
              color={CHART_STEPS.activity[1]}
            />
          }
        />
        <Stat
          label="Orders"
          value="0"
          chart={
            <Sparkline
              values={Array.from({ length: 30 }, () => 0)}
              color={CHART_STEPS.money[1]}
            />
          }
        />
        <Stat
          label="Net revenue"
          value="$8,241.90"
          chart={
            <Sparkline
              values={STEADY.map((s, i) => s - (REFUNDS[i] ?? 0))}
              color={CHART.money}
            />
          }
        />
      </div>
    ),
  },
];

export default function ChartFixtures(): React.ReactElement {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    // A fixed width, not a max — the cards are photographed by
    // `e2e/charts.spec.ts`, and a fluid container makes every baseline a
    // function of the viewport the runner happened to use. 564 puts the
    // card at exactly the 500px the committed baselines hold.
    <main className="mx-auto w-[564px] space-y-4 p-8">
      <h1 className="text-lg font-semibold">Chart fixtures</h1>
      {CASES.map((c) => (
        <Card key={c.id} className="p-5" data-case={c.id}>
          {c.node}
        </Card>
      ))}
    </main>
  );
}
