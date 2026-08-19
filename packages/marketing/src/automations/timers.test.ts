import { describe, expect, it } from "vitest";
import { safeZone, wakeAtFor } from "./timers";
import type { TimerNode } from "./graph";

/**
 * When a waiting run wakes up.
 *
 * The reason this is its own file is the reason `webhooks/policy.ts` is: it is
 * arithmetic, and arithmetic that has never been asserted is arithmetic that is
 * wrong. The interesting cases are all about the shop's timezone — "nine in the
 * morning" means nine where the seller is, and twice a year a local day is 23
 * or 25 hours long.
 *
 * `Europe/London` and `America/New_York` are used deliberately: their DST
 * transitions are two weeks apart, so a bug that happens to work in one zone
 * shows up in the other.
 */

const timer = (config: Partial<TimerNode> & { mode: string }) =>
  ({ id: "t", kind: "timer", ...config }) as TimerNode;

/** What the local wall clock reads at an instant, for asserting on. */
function local(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(at)
    .replace(",", "");
}

describe("duration", () => {
  it("is elapsed time, not wall-clock time", () => {
    /*
     * "Wait two days" means 48 hours whatever the calendar did in between,
     * which is what a seller means by it — and it is why this mode is the one
     * that does not consult the zone at all.
     */
    const now = new Date("2026-03-28T12:00:00Z");
    const wake = wakeAtFor(timer({ mode: "duration", minutes: 2_880 }), "Europe/London", now);
    expect(wake.getTime() - now.getTime()).toBe(2_880 * 60_000);
  });
});

describe("an absolute datetime", () => {
  it("waits until the moment", () => {
    const now = new Date("2026-08-01T00:00:00Z");
    const wake = wakeAtFor(
      timer({ mode: "at", at: "2026-09-01T09:00:00.000Z" }),
      "UTC",
      now,
    );
    expect(wake.toISOString()).toBe("2026-09-01T09:00:00.000Z");
  });

  it("does not wait for a moment that has passed", () => {
    /*
     * The one mode that can already be in the past: a seller sets a date and
     * contacts keep entering the flow afterwards. Resolving to `now` continues
     * the run rather than parking it on a moment that will never come again.
     */
    const now = new Date("2026-10-01T00:00:00Z");
    const wake = wakeAtFor(
      timer({ mode: "at", at: "2026-09-01T09:00:00.000Z" }),
      "UTC",
      now,
    );
    expect(wake.getTime()).toBe(now.getTime());
  });
});

describe("time of day, in the shop's zone", () => {
  it("finds this morning's slot when it has not passed", () => {
    const now = new Date("2026-06-15T06:00:00Z"); // 07:00 in London (BST)
    const wake = wakeAtFor(
      timer({ mode: "timeOfDay", hour: 9, minute: 30 }),
      "Europe/London",
      now,
    );
    expect(local(wake, "Europe/London")).toBe("2026-06-15 09:30");
  });

  it("rolls to tomorrow when it has", () => {
    const now = new Date("2026-06-15T10:00:00Z"); // 11:00 in London
    const wake = wakeAtFor(
      timer({ mode: "timeOfDay", hour: 9, minute: 30 }),
      "Europe/London",
      now,
    );
    expect(local(wake, "Europe/London")).toBe("2026-06-16 09:30");
  });

  it("means the same wall-clock hour on both sides of spring forward", () => {
    /*
     * The case a duration cannot express. London springs forward at 01:00 UTC
     * on 2026-03-29, so the local day is 23 hours long. A timer that added
     * 86,400,000ms would land at 08:30 and stay an hour early for the rest of
     * the year; searching for the next matching wall clock does not.
     */
    const before = new Date("2026-03-28T10:00:00Z"); // 10:00 local, GMT
    const first = wakeAtFor(
      timer({ mode: "timeOfDay", hour: 9, minute: 30 }),
      "Europe/London",
      before,
    );
    expect(local(first, "Europe/London")).toBe("2026-03-29 09:30");

    // And the UTC gap really is 23 hours, which is what makes it a test.
    const previous = wakeAtFor(
      timer({ mode: "timeOfDay", hour: 9, minute: 30 }),
      "Europe/London",
      new Date("2026-03-27T10:00:00Z"),
    );
    expect(first.getTime() - previous.getTime()).toBe(23 * 3_600_000);
  });

  it("means the same wall-clock hour on both sides of falling back", () => {
    /*
     * New York falls back at 06:00 UTC on 2026-11-01, so that local day is 25
     * hours long — and the pair that straddles it is
     * 09:00 on the 31st (EDT) and 09:00 on the 1st (EST). Both read 09:00
     * locally and they are 25 hours apart in UTC, which is the whole point.
     */
    const previous = wakeAtFor(
      timer({ mode: "timeOfDay", hour: 9, minute: 0 }),
      "America/New_York",
      new Date("2026-10-30T14:00:00Z"),
    );
    const next = wakeAtFor(
      timer({ mode: "timeOfDay", hour: 9, minute: 0 }),
      "America/New_York",
      new Date("2026-10-31T14:00:00Z"),
    );
    expect(local(previous, "America/New_York")).toBe("2026-10-31 09:00");
    expect(local(next, "America/New_York")).toBe("2026-11-01 09:00");
    expect(next.getTime() - previous.getTime()).toBe(25 * 3_600_000);
  });

  it("does not fire immediately when it is already exactly that time", () => {
    // Otherwise a timer set to "now" resolves to now, the run wakes, and the
    // timer fires again — a loop with no cycle in the graph.
    const now = new Date("2026-06-15T08:30:00Z"); // 09:30 in London
    const wake = wakeAtFor(
      timer({ mode: "timeOfDay", hour: 9, minute: 30 }),
      "Europe/London",
      now,
    );
    expect(wake.getTime()).toBeGreaterThan(now.getTime());
    expect(local(wake, "Europe/London")).toBe("2026-06-16 09:30");
  });
});

describe("day of week, in the shop's zone", () => {
  it("finds the next one", () => {
    // 2026-06-15 is a Monday. Asking for Thursday (4) lands on the 18th.
    const now = new Date("2026-06-15T06:00:00Z");
    const wake = wakeAtFor(
      timer({ mode: "dayOfWeek", weekday: 4, hour: 9, minute: 0 }),
      "Europe/London",
      now,
    );
    expect(local(wake, "Europe/London")).toBe("2026-06-18 09:00");
  });

  it("rolls a week when today's slot has passed", () => {
    // Monday 11:00 local, asking for Monday 09:00 — next Monday.
    const now = new Date("2026-06-15T10:00:00Z");
    const wake = wakeAtFor(
      timer({ mode: "dayOfWeek", weekday: 1, hour: 9, minute: 0 }),
      "Europe/London",
      now,
    );
    expect(local(wake, "Europe/London")).toBe("2026-06-22 09:00");
  });

  it("crosses a DST boundary without drifting", () => {
    // Sunday 09:00 New York, asked on the Monday before the fall-back Sunday.
    const now = new Date("2026-10-26T14:00:00Z");
    const wake = wakeAtFor(
      timer({ mode: "dayOfWeek", weekday: 0, hour: 9, minute: 0 }),
      "America/New_York",
      now,
    );
    expect(local(wake, "America/New_York")).toBe("2026-11-01 09:00");
  });
});

describe("a timezone the database no longer has", () => {
  it("falls back to UTC rather than throwing", () => {
    /*
     * A shop row can hold a zone that was valid when it was typed and has
     * since been removed. `Intl` throws a `RangeError` on one, and a throw
     * here would take down the whole tick — every seller's flows — over one
     * seller's stale column.
     */
    expect(safeZone("Mars/Olympus")).toBe("UTC");
    expect(safeZone(null)).toBe("UTC");
    expect(safeZone("Europe/London")).toBe("Europe/London");

    const wake = wakeAtFor(
      timer({ mode: "timeOfDay", hour: 9, minute: 0 }),
      "Mars/Olympus",
      new Date("2026-06-15T06:00:00Z"),
    );
    expect(wake.toISOString()).toBe("2026-06-15T09:00:00.000Z");
  });
});
