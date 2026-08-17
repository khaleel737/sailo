import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Keeping the delivery log from growing without bound.
 *
 * This is the one table in the schema whose row count grows with a shop's *traffic*
 * multiplied by its endpoints, so the cutoff is the only thing standing between a busy
 * shop and a table nobody can query. Nothing reads a delivery older than the log's own
 * thirty-day window.
 */

let cutoffs: unknown[];
let deleted: unknown[];

vi.mock("drizzle-orm", async (importActual) => {
  const actual = await importActual<typeof import("drizzle-orm")>();
  return {
    ...actual,
    lte: (_column: unknown, value: unknown) => {
      cutoffs.push(value);
      return { op: "lte", value };
    },
  };
});

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    delete: () => ({
      where: () => ({ returning: () => Promise.resolve(deleted) }),
    }),
  }),
}));

const { pruneWebhookDeliveries } = await import("./prune");

const NOW = new Date("2026-08-17T12:00:00.000Z");

beforeEach(() => {
  cutoffs = [];
  deleted = [];
});

describe("pruneWebhookDeliveries", () => {
  it("drops rows older than thirty days", async () => {
    await pruneWebhookDeliveries(NOW);

    const days = (NOW.getTime() - (cutoffs[0] as Date).getTime()) / 86_400_000;
    expect(days).toBe(30);
  });

  it("reports how many it dropped, so a sweep can be read", async () => {
    deleted = [{ id: "1" }, { id: "2" }, { id: "3" }];

    expect(await pruneWebhookDeliveries(NOW)).toBe(3);
  });

  it("reports zero on a clean table rather than throwing", async () => {
    expect(await pruneWebhookDeliveries(NOW)).toBe(0);
  });

  /*
   * `now` defaults rather than being required, because the hourly sweep calls it with
   * no argument. A default of `undefined` reaching `getTime()` would throw inside a
   * cron nobody watches.
   */
  it("defaults to the current time when called with nothing", async () => {
    await expect(pruneWebhookDeliveries()).resolves.toBe(0);
    expect(cutoffs[0]).toBeInstanceOf(Date);
  });
});
