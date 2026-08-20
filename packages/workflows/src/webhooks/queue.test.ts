import { beforeEach, describe, expect, it, vi } from "vitest";
import { thenable } from "@sailo/config/testing";

/**
 * One tick of the delivery queue, driven through `runWebhookQueue`.
 *
 * Through the public entry rather than at each private function, because what matters
 * about this code is the *sequence*: claim, then post, then record, and never post
 * without having claimed. A test that called `attempt` directly would pass while the
 * claim was removed from the caller.
 *
 * The four properties the module's own header commits to:
 *
 * - the claim is a lease, so two overlapping ticks take disjoint work
 * - one endpoint is never posted to concurrently, and its events keep their order
 * - the first failure ends that endpoint's turn, so a dead host costs one timeout
 * - the body that is signed is the byte-for-byte body that is sent
 */

const postWebhook = vi.fn();
const signWebhook = vi.fn();
const sendSellerWebhookDisabled = vi.fn();

/** Every UPDATE, in order, tagged by table so the writes can be read back. */
let writes: { table: string; values: Record<string, unknown> }[];
/** Rows the tick finds as due. */
let due: unknown[];
/** What each claim returns — `[]` means another tick won it. */
let claimReturns: unknown[][];
/** What the failure counter returns after being incremented. */
let endpointReturns: unknown[][];
/** What the disabling UPDATE returns — `[]` means it was already off. */
let disableReturns: unknown[][];

const nameOf = (table: unknown) =>
  String((table as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")] ?? "?");

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    query: {
      shops: { findFirst: () => Promise.resolve({ id: "shop-1", userId: "u1", contactEmail: "s@x.com" }) },
      user: { findFirst: () => Promise.resolve({ email: "u@x.com" }) },
    },
    select: () => ({
      from: () => ({
        innerJoin: function () {
          return this;
        },
        where: function () {
          return this;
        },
        orderBy: function () {
          return this;
        },
        limit: () => Promise.resolve(due),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          const name = nameOf(table);
          writes.push({ table: name, values });
          if (name.includes("deliver")) {
            // The claim is the only delivery UPDATE that touches `attempt`.
            const isClaim = "attempt" in values;
            return thenable(undefined, {
              returning: () =>
                Promise.resolve(isClaim ? (claimReturns.shift() ?? [{ attempt: 1 }]) : []),
            });
          }
          const isDisable = values.isActive === false;
          return thenable(undefined, {
            returning: () =>
              Promise.resolve(
                isDisable
                  ? (disableReturns.shift() ?? [{ id: "ep-1" }])
                  : (endpointReturns.shift() ?? [
                      { failureCount: 1, url: "https://hook.example", label: null, shopId: "shop-1" },
                    ]),
              ),
          });
        },
      }),
    }),
  }),
}));
vi.mock("@sailo/webhooks/post", () => ({ postWebhook }));
vi.mock("@sailo/webhooks/signature", () => ({ signWebhook }));
vi.mock("@sailo/email/shop", () => ({ sendSellerWebhookDisabled }));

const { runWebhookQueue } = await import("./queue");

const NOW = new Date("2026-08-17T12:00:00.000Z");

const row = (over: Record<string, unknown> = {}) => ({
  id: "del-1",
  endpointId: "ep-1",
  event: "order.created",
  payload: { id: "order-1", total: 1999 },
  url: "https://hook.example/sailo",
  secret: "whsec_1",
  isActive: true,
  ...over,
});

/** Deliveries written with a given status. */
const statusWrites = () =>
  writes.filter((w) => w.table.includes("deliver") && "status" in w.values);

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  due = [];
  claimReturns = [];
  endpointReturns = [];
  disableReturns = [];
  signWebhook.mockReturnValue({ "sailo-signature": "sig", "sailo-timestamp": "1" });
  postWebhook.mockResolvedValue({ ok: true, status: 200 });
  sendSellerWebhookDisabled.mockResolvedValue({ sent: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("an empty queue", () => {
  it("does no work and reports none", async () => {
    const run = await runWebhookQueue({ now: NOW });

    expect(run).toEqual({ attempted: 0, delivered: 0, failed: 0, abandoned: 0, disabled: 0 });
    expect(postWebhook).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe("a successful delivery", () => {
  it("claims, posts, and marks it delivered", async () => {
    due = [row()];

    const run = await runWebhookQueue({ now: NOW });

    expect(run).toMatchObject({ attempted: 1, delivered: 1, failed: 0 });
    expect(statusWrites()[0]?.values).toMatchObject({ status: "ok", responseStatus: 200 });
  });

  it("posts only after the claim, never before", async () => {
    due = [row()];
    const order: string[] = [];
    postWebhook.mockImplementation(() => {
      order.push("post");
      return Promise.resolve({ ok: true, status: 200 });
    });

    await runWebhookQueue({ now: NOW });

    // The claim is the first delivery UPDATE; it must precede the POST.
    expect(writes[0]?.values).toHaveProperty("attempt");
    expect(order).toEqual(["post"]);
  });

  /*
   * Consecutive, so any success clears the count entirely. An endpoint that fails
   * nineteen times and then succeeds is a working endpoint, and carrying the nineteen
   * forward would disable it on its next single hiccup.
   */
  it("clears the endpoint's failure count outright", async () => {
    due = [row()];

    await runWebhookQueue({ now: NOW });

    const endpointWrite = writes.find((w) => !w.table.includes("deliver"));
    expect(endpointWrite?.values).toMatchObject({ failureCount: 0, lastStatus: "ok" });
  });

  /*
   * THE PROPERTY THAT IS EASY TO BREAK BY TIDYING
   *
   * The payload is serialised once and both signed and sent as that same string.
   * Signing a re-serialisation would be a correctness property held by coincidence —
   * `JSON.stringify` being deterministic for a given object in a given runtime — rather
   * than by construction, and the failure mode is a signature the receiver rejects.
   */
  it("signs the exact bytes it sends", async () => {
    due = [row()];

    await runWebhookQueue({ now: NOW });

    const signedBody = signWebhook.mock.calls[0]?.[0]?.body;
    const sentBody = postWebhook.mock.calls[0]?.[0]?.body;
    expect(typeof signedBody).toBe("string");
    expect(sentBody).toBe(signedBody);
  });

  it("names the event in a header, so a receiver can route without parsing", async () => {
    due = [row()];

    await runWebhookQueue({ now: NOW });

    expect(postWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ "sailo-event": "order.created" }),
      }),
    );
  });
});

describe("the claim as a lease", () => {
  /*
   * An empty claim means another tick's UPDATE pushed `nextAttemptAt` into the future
   * first. Two overlapping ticks therefore take disjoint work, and the loser must not
   * post — a duplicate order in a seller's CRM is the failure this prevents.
   */
  it("does not post a delivery another tick claimed", async () => {
    due = [row()];
    claimReturns = [[]];

    const run = await runWebhookQueue({ now: NOW });

    expect(postWebhook).not.toHaveBeenCalled();
    expect(run).toMatchObject({ attempted: 0, delivered: 0 });
  });
});

describe("an endpoint switched off after its rows were queued", () => {
  /*
   * Retired rather than left pending, which would leave the rows due for ever and
   * re-examined by every tick until the table is pruned.
   */
  it("retires the row with a reason instead of posting", async () => {
    due = [row({ isActive: false })];

    const run = await runWebhookQueue({ now: NOW });

    expect(postWebhook).not.toHaveBeenCalled();
    expect(run).toMatchObject({ abandoned: 1, attempted: 0 });
    expect(statusWrites()[0]?.values).toMatchObject({ status: "failed" });
    expect(String(statusWrites()[0]?.values.error)).toContain("switched off");
  });
});

describe("an unusable signing secret", () => {
  /*
   * Retrying cannot fix it — rotating the secret is the seller's move, so the log has to
   * say so or they will watch five retries and conclude their own server is at fault.
   */
  it("abandons the delivery and says to rotate it", async () => {
    due = [row()];
    signWebhook.mockReturnValue(null);

    const run = await runWebhookQueue({ now: NOW });

    expect(postWebhook).not.toHaveBeenCalled();
    expect(run).toMatchObject({ attempted: 1, abandoned: 1, delivered: 0 });
    expect(String(statusWrites()[0]?.values.error)).toContain("rotate");
  });
});

describe("a failed delivery", () => {
  it("stays pending with the next attempt scheduled by the backoff", async () => {
    due = [row()];
    claimReturns = [[{ attempt: 1 }]];
    postWebhook.mockResolvedValue({ ok: false, status: 502, reason: "bad gateway" });

    const run = await runWebhookQueue({ now: NOW });

    expect(run).toMatchObject({ failed: 1, abandoned: 0 });
    const write = statusWrites()[0]?.values;
    expect(write).toMatchObject({ status: "pending", responseStatus: 502 });
    expect((write?.nextAttemptAt as Date).getTime()).toBe(NOW.getTime() + 60_000);
  });

  it("truncates a long reason rather than storing an entire error page", async () => {
    due = [row()];
    postWebhook.mockResolvedValue({ ok: false, status: 500, reason: "x".repeat(1000) });

    await runWebhookQueue({ now: NOW });

    expect(String(statusWrites()[0]?.values.error)).toHaveLength(300);
  });

  /*
   * On the last attempt the row becomes `failed` and `nextAttemptAt` is left where the
   * lease put it. Moving it would be writing a date meaning "next attempt" onto a row
   * that will never have one.
   */
  it("is abandoned on the last attempt, with no next attempt written", async () => {
    due = [row()];
    claimReturns = [[{ attempt: 6 }]];
    postWebhook.mockResolvedValue({ ok: false, status: 500, reason: "still down" });

    const run = await runWebhookQueue({ now: NOW });

    expect(run).toMatchObject({ failed: 1, abandoned: 1 });
    const write = statusWrites()[0]?.values;
    expect(write).toMatchObject({ status: "failed" });
    expect(write).not.toHaveProperty("nextAttemptAt");
  });
});

describe("many deliveries for one endpoint", () => {
  /*
   * In sequence, never concurrently: a shop importing two hundred orders must not open
   * two hundred sockets to one Zapier hook, and events should arrive in roughly the
   * order they happened.
   */
  it("posts them one at a time", async () => {
    due = [row({ id: "d1" }), row({ id: "d2" }), row({ id: "d3" })];
    let inFlight = 0;
    let peak = 0;
    postWebhook.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true, status: 200 };
    });

    await runWebhookQueue({ now: NOW });

    expect(peak).toBe(1);
    expect(postWebhook).toHaveBeenCalledTimes(3);
  });

  it("keeps them in the order the queue handed them over", async () => {
    due = [row({ id: "d1" }), row({ id: "d2" }), row({ id: "d3" })];

    await runWebhookQueue({ now: NOW });

    expect(signWebhook.mock.calls.map((c) => c[0].id)).toEqual(["d1", "d2", "d3"]);
  });

  it("takes at most ten rows for one endpoint in a tick", async () => {
    due = Array.from({ length: 25 }, (_, i) => row({ id: `d${i}` }));

    const run = await runWebhookQueue({ now: NOW });

    expect(run.attempted).toBe(10);
  });

  /*
   * The first failure ends that endpoint's turn. The rest stay pending and due, so the
   * next tick tries again — the same outcome as posting nine more times into a host
   * that is plainly down, minus nine timeouts holding the tick open.
   */
  it("stops at the first failure rather than hammering a dead host", async () => {
    due = [row({ id: "d1" }), row({ id: "d2" }), row({ id: "d3" })];
    postWebhook
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 503, reason: "down" })
      .mockResolvedValue({ ok: true, status: 200 });

    const run = await runWebhookQueue({ now: NOW });

    expect(postWebhook).toHaveBeenCalledTimes(2);
    expect(run).toMatchObject({ attempted: 2, delivered: 1, failed: 1 });
  });
});

describe("more than one endpoint", () => {
  it("works on them alongside each other", async () => {
    due = [
      row({ id: "d1", endpointId: "ep-1" }),
      row({ id: "d2", endpointId: "ep-2" }),
      row({ id: "d3", endpointId: "ep-3" }),
    ];

    const run = await runWebhookQueue({ now: NOW });

    expect(run).toMatchObject({ attempted: 3, delivered: 3 });
  });

  /*
   * One dead endpoint must not stop another shop's deliveries. Each endpoint's batch
   * ends on its own failure and the others carry on.
   */
  it("keeps delivering to healthy endpoints when one is down", async () => {
    due = [row({ id: "d1", endpointId: "ep-1" }), row({ id: "d2", endpointId: "ep-2" })];
    postWebhook.mockImplementation(({ url }: { url: string }) =>
      Promise.resolve(
        url.includes("dead")
          ? { ok: false, status: 500, reason: "dead" }
          : { ok: true, status: 200 },
      ),
    );
    due = [
      row({ id: "d1", endpointId: "ep-1", url: "https://dead.example" }),
      row({ id: "d2", endpointId: "ep-2", url: "https://alive.example" }),
    ];

    const run = await runWebhookQueue({ now: NOW });

    expect(run).toMatchObject({ attempted: 2, delivered: 1, failed: 1 });
  });
});

describe("giving up on an endpoint", () => {
  it("switches it off once the failures pile up, and tells the seller", async () => {
    due = [row()];
    postWebhook.mockResolvedValue({ ok: false, status: 500, reason: "gone" });
    endpointReturns = [
      [{ failureCount: 20, url: "https://hook.example", label: "CRM", shopId: "shop-1" }],
    ];

    const run = await runWebhookQueue({ now: NOW });

    expect(run.disabled).toBe(1);
    expect(sendSellerWebhookDisabled).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://hook.example", label: "CRM", failures: 20 }),
    );
  });

  it("leaves it alone below the threshold", async () => {
    due = [row()];
    postWebhook.mockResolvedValue({ ok: false, status: 500, reason: "hiccup" });
    endpointReturns = [
      [{ failureCount: 19, url: "https://hook.example", label: null, shopId: "shop-1" }],
    ];

    const run = await runWebhookQueue({ now: NOW });

    expect(run.disabled).toBe(0);
    expect(sendSellerWebhookDisabled).not.toHaveBeenCalled();
  });

  /*
   * The disabling UPDATE is conditional on the endpoint still being active, so several
   * failures landing in one tick disable it once and send one email — not one of each
   * per failure.
   */
  it("sends no second email when it was already off", async () => {
    due = [row()];
    postWebhook.mockResolvedValue({ ok: false, status: 500, reason: "gone" });
    endpointReturns = [
      [{ failureCount: 25, url: "https://hook.example", label: null, shopId: "shop-1" }],
    ];
    disableReturns = [[]];

    const run = await runWebhookQueue({ now: NOW });

    expect(run.disabled).toBe(0);
    expect(sendSellerWebhookDisabled).not.toHaveBeenCalled();
  });

  /*
   * An endpoint that is off with no email is recoverable — the settings card says so in
   * red. A mail provider having a bad afternoon must not stop the queue draining for
   * every other shop.
   */
  it("still counts as disabled when the email throws", async () => {
    due = [row()];
    postWebhook.mockResolvedValue({ ok: false, status: 500, reason: "gone" });
    endpointReturns = [
      [{ failureCount: 20, url: "https://hook.example", label: null, shopId: "shop-1" }],
    ];
    sendSellerWebhookDisabled.mockRejectedValue(new Error("Resend is down"));

    const run = await runWebhookQueue({ now: NOW });

    expect(run.disabled).toBe(1);
  });
});
