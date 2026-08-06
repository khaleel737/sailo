import { describe, expect, it } from "vitest";
import {
  asUtc,
  expiredPartitions,
  partitionName,
  type Partition,
} from "./visit-partitions";

const month = (year: number, m: number): Partition => ({
  name: `visits_${year}_${String(m).padStart(2, "0")}`,
  from: new Date(Date.UTC(year, m - 1, 1)),
  to: new Date(Date.UTC(year, m, 1)),
});

describe("partitionName", () => {
  it("pads the month so the names sort chronologically", () => {
    expect(partitionName(new Date(Date.UTC(2026, 0, 1)))).toBe(
      "visits_2026_01",
    );
    expect(partitionName(new Date(Date.UTC(2026, 8, 1)))).toBe(
      "visits_2026_09",
    );
    expect(partitionName(new Date(Date.UTC(2026, 11, 1)))).toBe(
      "visits_2026_12",
    );
  });

  it("sorts as text in the same order as in time", () => {
    const names = [
      new Date(Date.UTC(2026, 11, 1)),
      new Date(Date.UTC(2027, 0, 1)),
      new Date(Date.UTC(2026, 1, 1)),
      new Date(Date.UTC(2026, 9, 1)),
    ].map(partitionName);
    expect([...names].sort()).toEqual([
      "visits_2026_02",
      "visits_2026_10",
      "visits_2026_12",
      "visits_2027_01",
    ]);
  });

  it("reads the month in UTC, not the machine's timezone", () => {
    // 1 Jan UTC is 31 Dec in the Americas. Naming off local time would file
    // January's data under the previous December.
    expect(partitionName(new Date("2026-01-01T00:00:00Z"))).toBe(
      "visits_2026_01",
    );
  });
});

describe("expiredPartitions", () => {
  const partitions = [
    month(2026, 5),
    month(2026, 6),
    month(2026, 7),
    month(2026, 8),
  ];

  it("drops only the months entirely behind the cutoff", () => {
    // 90 days before 6 Aug lands inside May, so May is still partly in window.
    const cutoff = new Date(Date.UTC(2026, 4, 8));
    expect(expiredPartitions(partitions, cutoff)).toEqual([]);
  });

  it("drops a month the moment its end is reached", () => {
    const cutoff = new Date(Date.UTC(2026, 5, 1));
    expect(expiredPartitions(partitions, cutoff).map((p) => p.name)).toEqual([
      "visits_2026_05",
    ]);
  });

  it("never drops the month the cutoff falls inside", () => {
    /*
     * The boundary this test exists for. `to` is exclusive, so June's partition
     * covers up to but not including 1 July. A cutoff of 15 June still needs
     * 15–30 June, and dropping June would take a fortnight of data the
     * retention window promises.
     */
    const cutoff = new Date(Date.UTC(2026, 5, 15));
    const dropped = expiredPartitions(partitions, cutoff).map((p) => p.name);
    expect(dropped).toEqual(["visits_2026_05"]);
    expect(dropped).not.toContain("visits_2026_06");
  });

  it("keeps every future month", () => {
    const cutoff = new Date(Date.UTC(2026, 0, 1));
    expect(expiredPartitions(partitions, cutoff)).toEqual([]);
  });

  it("would drop them all only once the cutoff is past every end", () => {
    const cutoff = new Date(Date.UTC(2027, 0, 1));
    expect(expiredPartitions(partitions, cutoff)).toHaveLength(4);
  });

  it("copes with nothing to consider", () => {
    expect(expiredPartitions([], new Date())).toEqual([]);
  });

  it("does not care what order they arrive in", () => {
    const shuffled = [
      month(2026, 8),
      month(2026, 5),
      month(2026, 7),
      month(2026, 6),
    ];
    const cutoff = new Date(Date.UTC(2026, 6, 1));
    expect(
      expiredPartitions(shuffled, cutoff)
        .map((p) => p.name)
        .sort(),
    ).toEqual(["visits_2026_05", "visits_2026_06"]);
  });
});

describe("asUtc", () => {
  /*
   * The bug this pins cost a day of retention. `pg_get_expr` returns a bound as
   * `2026-07-01 00:00:00` with no zone, and `new Date` of that reads it in the
   * machine's timezone. On a box at UTC+2 every partition looked like it began
   * two hours earlier than it does — enough for the nightly job to drop a month
   * before its data had aged out.
   */
  it("reads a bare Postgres timestamp as UTC", () => {
    expect(asUtc("2026-07-01 00:00:00").toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
  });

  it("lands exactly on the month boundary, whatever the host timezone", () => {
    const start = asUtc("2026-08-01 00:00:00");
    expect(start.getUTCDate()).toBe(1);
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMonth()).toBe(7);
  });

  it("agrees with the name the partition was created under", () => {
    // Round trip: the bound a partition reports must map back to its own name.
    for (const bound of [
      "2026-01-01 00:00:00",
      "2026-10-01 00:00:00",
      "2027-12-01 00:00:00",
    ]) {
      const parsed = asUtc(bound);
      expect(partitionName(parsed)).toBe(
        `visits_${bound.slice(0, 4)}_${bound.slice(5, 7)}`,
      );
    }
  });

  it("tolerates the whitespace pg_get_expr may hand back", () => {
    expect(asUtc("  2026-07-01 00:00:00  ").toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
  });
});
