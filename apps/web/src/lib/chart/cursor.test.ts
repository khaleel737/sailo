import { describe, expect, it } from "vitest";
import { indexAtPointer, snapshotAt, sumOf, type Bands } from "./cursor";
import type { Series } from "./types";

const bands: Bands = { offset: 0, step: 10, count: 5 };

const series: Series[] = [
  {
    key: "sales",
    label: "Sales",
    values: [100, 200, 300, 0, 50],
  },
  {
    key: "refunds",
    label: "Refunds",
    negative: true,
    values: [0, 40, 0, 0, 10],
  },
];

describe("indexAtPointer", () => {
  it("maps a pointer to the column under it", () => {
    expect(indexAtPointer(0, bands)).toBe(0);
    expect(indexAtPointer(9, bands)).toBe(0);
    expect(indexAtPointer(10, bands)).toBe(1);
    expect(indexAtPointer(25, bands)).toBe(2);
    expect(indexAtPointer(49, bands)).toBe(4);
  });

  it("clamps rather than blanking at the edges", () => {
    // A pointer just past the last column is still reaching for it. Returning
    // null here is what makes a chart feel like it has dead zones.
    expect(indexAtPointer(-30, bands)).toBe(0);
    expect(indexAtPointer(999, bands)).toBe(4);
  });

  it("respects a left offset, as a padded band scale has", () => {
    const offset: Bands = { offset: 24, step: 10, count: 3 };
    expect(indexAtPointer(24, offset)).toBe(0);
    expect(indexAtPointer(35, offset)).toBe(1);
    expect(indexAtPointer(20, offset)).toBe(0);
  });

  it("refuses nonsense instead of returning a wrong day", () => {
    expect(indexAtPointer(5, { offset: 0, step: 10, count: 0 })).toBeNull();
    expect(indexAtPointer(5, { offset: 0, step: 0, count: 5 })).toBeNull();
    expect(indexAtPointer(Number.NaN, bands)).toBeNull();
  });

  it("never points past the data, whatever the width", () => {
    for (const count of [1, 7, 30, 365]) {
      const wide: Bands = { offset: 0, step: 3.7, count };
      for (const x of [-1e6, 0, 12.5, 1e6]) {
        const i = indexAtPointer(x, wide);
        expect(i).not.toBeNull();
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(count);
      }
    }
  });
});

describe("snapshotAt", () => {
  const days = [
    "2026-08-01",
    "2026-08-02",
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
  ];

  it("reports every series for the day", () => {
    expect(snapshotAt(1, days, series)).toEqual({
      index: 1,
      day: "2026-08-02",
      values: [
        { key: "sales", label: "Sales", value: 200 },
        { key: "refunds", label: "Refunds", value: 40 },
      ],
    });
  });

  it("reports a refund as an amount refunded, not as a negative sale", () => {
    // Only the drawing cares which side of the axis it sits on. "Refunds −$40"
    // would be telling the reader about the chart, not about their shop.
    const snapshot = snapshotAt(1, days, series);
    expect(snapshot?.values[1]?.value).toBe(40);
  });

  it("reads a day with nothing on it as zero, not as missing", () => {
    expect(snapshotAt(3, days, series)?.values).toEqual([
      { key: "sales", label: "Sales", value: 0 },
      { key: "refunds", label: "Refunds", value: 0 },
    ]);
  });

  it("is null off the end of the days", () => {
    expect(snapshotAt(9, days, series)).toBeNull();
    expect(snapshotAt(-1, days, series)).toBeNull();
    expect(snapshotAt(0, [], series)).toBeNull();
  });

  it("fills a series that is shorter than the window", () => {
    const short: Series[] = [
      { key: "a", label: "A", values: [1] },
    ];
    expect(snapshotAt(3, days, short)?.values).toEqual([
      { key: "a", label: "A", value: 0 },
    ]);
  });
});

describe("sumOf", () => {
  it("totals a series", () => {
    expect(sumOf(series[0])).toBe(650);
  });

  it("is zero for nothing", () => {
    expect(sumOf(undefined)).toBe(0);
    expect(sumOf({ key: "a", label: "A", values: [] })).toBe(0);
  });
});
