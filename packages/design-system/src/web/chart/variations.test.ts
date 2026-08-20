import { describe, expect, it } from "vitest";
import {
  barRect,
  chartDomain,
  hasData,
  indexAtPointer,
  peak,
  plotted,
  snapshotAt,
  sumOf,
  toPercent,
  type Series,
} from "../../chart";

/**
 * The same invariants, over a lot of different shops.
 *
 * The unit tests pin specific cases that were once wrong. This file asks a
 * different question: whatever the data, does the chart stay honest? A seller
 * on their first day, a seller doing six figures, a week of pure refunds, a
 * year at a time, and the money-shaped edges — a single cent beside a million,
 * a day that is exactly zero, a value that would round to nothing.
 *
 * Deterministic on purpose. `Math.random` would make a failure impossible to
 * reproduce from the output, so the generator is a seeded LCG and every case
 * prints the seed that produced it.
 */

/** Numerical Recipes LCG — small, seeded, and good enough for fixtures. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function daysOf(count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
  );
}

type Shape = {
  name: string;
  /** Builds sales and refunds for `count` days from a seeded generator. */
  build: (count: number, next: () => number) => { sales: number[]; refunds: number[] };
};

const SHAPES: Shape[] = [
  {
    name: "a brand new shop — nothing at all",
    build: (n) => ({ sales: Array(n).fill(0), refunds: Array(n).fill(0) }),
  },
  {
    name: "one sale, ever",
    build: (n) => ({
      sales: Array.from({ length: n }, (_, i) => (i === Math.floor(n / 2) ? 4999 : 0)),
      refunds: Array(n).fill(0),
    }),
  },
  {
    name: "steady trade",
    build: (n, next) => ({
      sales: Array.from({ length: n }, () => Math.round(next() * 50_000)),
      refunds: Array(n).fill(0),
    }),
  },
  {
    name: "a flat week — every day identical",
    build: (n) => ({ sales: Array(n).fill(9_900), refunds: Array(n).fill(0) }),
  },
  {
    name: "one catastrophic refund",
    build: (n, next) => ({
      sales: Array.from({ length: n }, () => Math.round(next() * 20_000)),
      refunds: Array.from({ length: n }, (_, i) => (i === 3 ? 900_000 : 0)),
    }),
  },
  {
    name: "refunds only — a week of returns",
    build: (n, next) => ({
      sales: Array(n).fill(0),
      refunds: Array.from({ length: n }, () => Math.round(next() * 30_000)),
    }),
  },
  {
    name: "a cent beside a fortune",
    build: (n) => ({
      sales: Array.from({ length: n }, (_, i) => (i === 0 ? 1 : i === 1 ? 100_000_000 : 0)),
      refunds: Array(n).fill(0),
    }),
  },
  {
    name: "busy, with returns throughout",
    build: (n, next) => ({
      sales: Array.from({ length: n }, () => Math.round(next() * 80_000)),
      refunds: Array.from({ length: n }, () => (next() > 0.7 ? Math.round(next() * 40_000) : 0)),
    }),
  },
];

const WINDOWS = [1, 2, 7, 14, 30, 90, 365];
const SEEDS = [1, 7, 42, 1337];

/** The revenue card's real series list, for a given dataset. */
function revenueSeries(sales: number[], refunds: number[]): Series[] {
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

describe("every shop, every window", () => {
  for (const shape of SHAPES) {
    for (const count of WINDOWS) {
      for (const seed of SEEDS) {
        const label = `${shape.name} · ${count}d · seed ${seed}`;

        it(label, () => {
          const { sales, refunds } = shape.build(count, rng(seed));
          const days = daysOf(count);
          const series = revenueSeries(sales, refunds);
          const domain = chartDomain(series);

          /* ---------------------------------------------- the axis is sane */
          expect(Number.isFinite(domain.min)).toBe(true);
          expect(Number.isFinite(domain.max)).toBe(true);
          // Zero is always in frame, so a flat week reads flat and a losing
          // day has a baseline to hang from.
          expect(domain.min).toBeLessThanOrEqual(0);
          expect(domain.max).toBeGreaterThanOrEqual(0);
          expect(domain.max).toBeGreaterThanOrEqual(domain.min);

          /* ------------------- a reported-only measure never moves the axis */
          // Net can exceed neither bar in magnitude only because it is excluded;
          // including it would let a summary stretch the scale of its own parts.
          const withoutNet = chartDomain(plotted(series));
          expect(withoutNet).toEqual(domain);

          /* ------------------------------------- every mark lands in frame */
          for (const s of plotted(series)) {
            for (const raw of s.values) {
              const value = s.negative ? -Math.abs(raw) : raw;
              const y = toPercent(value, domain);
              expect(Number.isFinite(y)).toBe(true);
              expect(y).toBeGreaterThanOrEqual(-0.001);
              expect(y).toBeLessThanOrEqual(100.001);

              const rect = barRect(value, domain);
              expect(Number.isFinite(rect.top)).toBe(true);
              expect(Number.isFinite(rect.height)).toBe(true);
              expect(rect.height).toBeGreaterThan(0);
              // A real figure is never drawn as nothing, and never as a zero day.
              if (value !== 0) {
                expect(rect.height).toBeGreaterThanOrEqual(3);
                expect(rect).not.toEqual(barRect(0, domain));
              }
            }
          }

          /* -------------------------------------- the cursor always lands */
          const bands = { offset: 0, step: 640 / count, count };
          for (const x of [-500, 0, 1, 320, 639, 640, 5000]) {
            const index = indexAtPointer(x, bands);
            expect(index).not.toBeNull();
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(count);

            const snapshot = snapshotAt(index as number, days, series);
            expect(snapshot).not.toBeNull();
            // The readout names every series, drawn or not — net included.
            expect(snapshot?.values).toHaveLength(3);
            for (const entry of snapshot?.values ?? []) {
              expect(Number.isFinite(entry.value)).toBe(true);
            }
          }

          /* --------------------------------- totals agree with the figures */
          const net = series[2] as Series;
          expect(sumOf(net)).toBe(sumOf(series[0]) - sumOf(series[1]));

          /* ------------------------------------- peak agrees with the data */
          const top = peak(series);
          expect(top === null).toBe(!hasData(series));
          if (top) {
            const drawnValues = plotted(series).flatMap((s) => s.values);
            const largest = Math.max(...drawnValues.map((v) => Math.abs(v)));
            expect(Math.abs(top.value)).toBe(largest);
            expect(top.index).toBeGreaterThanOrEqual(0);
            expect(top.index).toBeLessThan(count);
          }
        });
      }
    }
  }
});

describe("data that should not exist but might", () => {
  const days = daysOf(3);

  /*
   * The empty chart, the short series and the sign of a negative series are
   * pinned where the rules live — `../../chart`'s own `domain.test.ts` and
   * `cursor.test.ts`. This file keeps only the shapes those files do not have.
   */

  it("survives a series longer than the window", () => {
    const series: Series[] = [{ key: "a", label: "A", values: [1, 2, 3, 4, 5] }];
    // The extra days are simply never reached by the cursor.
    expect(snapshotAt(4, days, series)).toBeNull();
    expect(chartDomain(series).max).toBe(5);
  });

  it("survives a chart of nothing but a reported figure", () => {
    // Nothing is drawn, so there is nothing to scale to — and no crash.
    const series: Series[] = [
      { key: "net", label: "Net", readoutOnly: true, values: [10, 20] },
    ];
    expect(hasData(series)).toBe(false);
    expect(peak(series)).toBeNull();
    expect(chartDomain(series)).toEqual({ min: 0, max: 0 });
    // It still reports: the headline figure comes from the series, not the plot.
    expect(sumOf(series[0])).toBe(30);
  });
});
