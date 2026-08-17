import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Closing a broadcast, exactly once.
 *
 * Two ticks can be draining one broadcast's queue at the same moment, and both will reach
 * this function. Only the one that finds nothing left queued may close it, and the `from`
 * guard is what stops the loser closing it a second time — which would move `sentAt` and
 * make a seller's "sent at 09:14" become 09:19 for no reason they could explain.
 *
 * It was a private function inside a 710-line module, so neither rule had a test.
 */

let queuedCount: string;
let updates: { values: Record<string, unknown> }[];

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => Promise.resolve([{ n: queuedCount }]) }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push({ values });
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

const { finish } = await import("./finish");

beforeEach(() => {
  queuedCount = "0";
  updates = [];
});

describe("finish", () => {
  it("closes a broadcast whose queue is empty", async () => {
    await finish("b1");

    expect(updates).toHaveLength(1);
    expect(updates[0]?.values).toMatchObject({ status: "sent" });
    expect(updates[0]?.values.sentAt).toBeInstanceOf(Date);
  });

  /*
   * Anything still queued means another tick has work to do. Closing here would mark a
   * broadcast sent while recipients are still waiting for it, and the remaining batches
   * would then go out against a broadcast the screen says is finished.
   */
  it("leaves it open while anything is still queued", async () => {
    queuedCount = "40";

    await finish("b1");

    expect(updates).toHaveLength(0);
  });

  it("counts a single remaining delivery as still queued", async () => {
    queuedCount = "1";

    await finish("b1");

    expect(updates).toHaveLength(0);
  });

  /*
   * The count comes back as a string from `count(*)`, and `Number("0")` is falsy while
   * `"0"` itself is truthy. Reading it without the conversion would close nothing, ever.
   */
  it("reads the count as a number, not as a truthy string", async () => {
    queuedCount = "0";

    await finish("b1");

    expect(updates).toHaveLength(1);
  });

  it("survives a count that is missing entirely", async () => {
    queuedCount = undefined as unknown as string;

    await expect(finish("b1")).resolves.toBeUndefined();
  });
});
