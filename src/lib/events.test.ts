import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The realtime bus, exercised in both of its lives.
 *
 * Without Redis it must still work end to end inside one process — that is
 * every development machine and every preview deploy — and it must degrade
 * to that quietly rather than throwing at the write paths that publish, all
 * of which sit on money-carrying requests. With Redis it must hand events
 * to the shared channel and *not* also deliver them locally, because the
 * stream layer is subscribed on both ears and would hear everything twice.
 *
 * The gates matter as much as delivery: visits arrive at storefront-traffic
 * speed, and every event an open dashboard hears becomes a round of
 * queries. One announcement per window is the property that keeps the bus
 * from being a self-inflicted load test.
 */

type LocalBusGlobal = typeof globalThis & { sailoLocalBus?: unknown };

describe("the bus without Redis", () => {
  const original = process.env.REDIS_URL;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("redis");
    delete process.env.REDIS_URL;
    // The emitter survives module resets by design (it lives on globalThis
    // so HMR can't strand listeners); tests need the opposite, a clean ear.
    delete (globalThis as LocalBusGlobal).sailoLocalBus;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
    delete (globalThis as LocalBusGlobal).sailoLocalBus;
  });

  it("delivers a shop event to that shop's subscriber, in-process", async () => {
    const { publishShopEvent, subscribeShopEvents } = await import("./events");

    const heard: string[] = [];
    const sub = await subscribeShopEvents("shop-1", (e) => heard.push(e.kind));

    await publishShopEvent("shop-1", "order");
    expect(heard).toEqual(["order"]);
    expect(sub.live).toBe(false);

    await sub.close();
  });

  it("does not leak one shop's events to another shop", async () => {
    const { publishShopEvent, subscribeShopEvents } = await import("./events");

    const heard: string[] = [];
    const sub = await subscribeShopEvents("shop-2", (e) => heard.push(e.kind));

    await publishShopEvent("shop-1", "order");
    expect(heard).toEqual([]);

    await sub.close();
  });

  it("gates visits to one announcement per window, and only visits", async () => {
    const { publishShopEvent, subscribeShopEvents } = await import("./events");

    const heard: string[] = [];
    const sub = await subscribeShopEvents("shop-1", (e) => heard.push(e.kind));

    await publishShopEvent("shop-1", "visit");
    await publishShopEvent("shop-1", "visit");
    await publishShopEvent("shop-1", "order");
    await publishShopEvent("shop-1", "order");

    // One visit — the second fell to the gate. Both orders — a paying
    // customer is never "too frequent".
    expect(heard).toEqual(["visit", "order", "order"]);

    await sub.close();
  });

  it("mirrors orders onto hq, but never visits", async () => {
    const { publishShopEvent, subscribeHqEvents } = await import("./events");

    const heard: string[] = [];
    const sub = await subscribeHqEvents((e) => heard.push(e.kind));

    await publishShopEvent("shop-1", "visit");
    await publishShopEvent("shop-1", "order");

    expect(heard).toEqual(["order"]);

    await sub.close();
  });

  it("gates the hq mirror across shops sharing a window", async () => {
    const { publishShopEvent, subscribeHqEvents, subscribeShopEvents } =
      await import("./events");

    const hqHeard: string[] = [];
    const shopHeard: string[] = [];
    const hq = await subscribeHqEvents((e) => hqHeard.push(e.kind));
    const shop = await subscribeShopEvents("shop-2", (e) =>
      shopHeard.push(e.kind),
    );

    await publishShopEvent("shop-1", "order");
    await publishShopEvent("shop-2", "order");

    // hq heard the platform's first order and coalesced the second; the
    // second shop's own dashboard still heard its own order.
    expect(hqHeard).toEqual(["order"]);
    expect(shopHeard).toEqual(["order"]);

    await hq.close();
    await shop.close();
  });

  it("hears nothing after close", async () => {
    const { publishShopEvent, subscribeShopEvents } = await import("./events");

    const heard: string[] = [];
    const sub = await subscribeShopEvents("shop-1", (e) => heard.push(e.kind));
    await sub.close();

    await publishShopEvent("shop-1", "order");
    expect(heard).toEqual([]);

    // Closing twice is a no-op, not an error — the stream layer closes on
    // abort and on deadline, and the two can race.
    await sub.close();
  });

  it("delivers affiliate events on the affiliate's own channel", async () => {
    const { publishAffiliateEvent, subscribeAffiliateEvents, subscribeShopEvents } =
      await import("./events");

    const heard: string[] = [];
    const shopHeard: string[] = [];
    const sub = await subscribeAffiliateEvents("aff-1", (e) =>
      heard.push(e.kind),
    );
    const shop = await subscribeShopEvents("aff-1", (e) =>
      shopHeard.push(e.kind),
    );

    await publishAffiliateEvent("aff-1", "order");

    // The two channel families never cross, even sharing an id.
    expect(heard).toEqual(["order"]);
    expect(shopHeard).toEqual([]);

    await sub.close();
    await shop.close();
  });
});

describe("the bus with Redis answering", () => {
  const original = process.env.REDIS_URL;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env.REDIS_URL = "redis://localhost:6379";
    delete (globalThis as LocalBusGlobal).sailoLocalBus;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
    delete (globalThis as LocalBusGlobal).sailoLocalBus;
  });

  /**
   * A mock client whose pub/sub actually connects the two halves, so the
   * test observes the wire rather than a list of calls: `publish` hands the
   * message to whatever a duplicated subscriber registered for the channel.
   */
  function mockRedis() {
    const listeners = new Map<string, Array<(message: string) => void>>();
    const client = {
      on: vi.fn(),
      connect: vi.fn(async () => undefined),
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
      publish: vi.fn(async (channel: string, message: string) => {
        for (const fn of listeners.get(channel) ?? []) fn(message);
        return listeners.get(channel)?.length ?? 0;
      }),
      duplicate: vi.fn(() => ({
        on: vi.fn(),
        connect: vi.fn(async () => undefined),
        destroy: vi.fn(),
        subscribe: vi.fn(
          async (channel: string, listener: (message: string) => void) => {
            listeners.set(channel, [
              ...(listeners.get(channel) ?? []),
              listener,
            ]);
          },
        ),
      })),
    };
    vi.doMock("redis", () => ({ createClient: () => client }));
    return { client, listeners };
  }

  it("delivers over the shared channel, and only over it", async () => {
    const { client } = mockRedis();
    const { publishShopEvent, subscribeShopEvents } = await import("./events");

    const heard: string[] = [];
    const sub = await subscribeShopEvents("shop-1", (e) => heard.push(e.kind));
    expect(sub.live).toBe(true);

    await publishShopEvent("shop-1", "order");

    // Once. If local emit ran alongside Redis delivery, this would be two —
    // every same-instance dashboard hearing everything twice.
    expect(heard).toEqual(["order"]);
    expect(client.publish).toHaveBeenCalledWith(
      "sailo:ev:shop:shop-1",
      JSON.stringify({ kind: "order" }),
    );

    await sub.close();
  });

  it("drops a malformed message instead of surfacing it", async () => {
    const { listeners } = mockRedis();
    const { subscribeShopEvents } = await import("./events");

    const heard: string[] = [];
    const sub = await subscribeShopEvents("shop-1", (e) => heard.push(e.kind));

    for (const fn of listeners.get("sailo:ev:shop:shop-1") ?? []) {
      fn("not json");
      fn(JSON.stringify({ kind: "not-a-kind" }));
      fn(JSON.stringify({ kind: "order" }));
    }

    // Only the well-formed one got through; the rest died quietly, because
    // a poisoned channel must not become a crashed dashboard stream.
    expect(heard).toEqual(["order"]);

    await sub.close();
  });

  it("destroys its subscriber connection on close", async () => {
    const { client } = mockRedis();
    const { subscribeShopEvents } = await import("./events");

    const sub = await subscribeShopEvents("shop-1", () => {});
    await sub.close();

    const dup = client.duplicate.mock.results[0]?.value as {
      destroy: ReturnType<typeof vi.fn>;
    };
    expect(dup.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("the bus with Redis unreachable", () => {
  const original = process.env.REDIS_URL;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("redis");
    delete (globalThis as LocalBusGlobal).sailoLocalBus;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
    delete (globalThis as LocalBusGlobal).sailoLocalBus;
  });

  it("publishes fall back to local delivery and never throw", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { publishShopEvent, subscribeShopEvents } = await import("./events");

    const heard: string[] = [];
    const sub = await subscribeShopEvents("shop-1", (e) => heard.push(e.kind));
    expect(sub.live).toBe(false);

    // The property the write paths depend on: this resolves, quietly, and
    // same-instance listeners still hear the event.
    await expect(
      publishShopEvent("shop-1", "order"),
    ).resolves.toBeUndefined();
    expect(heard).toEqual(["order"]);

    await sub.close();
  }, 20_000);
});
