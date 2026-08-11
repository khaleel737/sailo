import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The limiter's behaviour when its own backend is gone.
 *
 * Failing open is the right call and is deliberate — a rate limiter that
 * blocks real buyers because a cache went down has cost more than the traffic
 * it stopped. What was wrong was that it happened *silently*: every ceiling in
 * the app — signup, sign-in, checkout, the affiliate form, the download route,
 * the invoice PDF, better-auth's own endpoints — disappears at the same
 * moment, and the only outward sign is an absence of throttling, which looks
 * exactly like not being attacked.
 *
 * These pin the two properties that make that survivable: it still fails open,
 * and it says so once rather than either never or on every request.
 */

const OK = { allowed: true, remaining: 10 };

describe("rateLimit without a backend", () => {
  const original = process.env.REDIS_URL;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
  });

  it("allows the request when Redis is not configured", async () => {
    delete process.env.REDIS_URL;
    const { rateLimit } = await import("./redis");

    const verdict = await rateLimit("test", 10, 60);
    expect(verdict).toEqual(OK);
  });

  it("says nothing when Redis was never configured at all", async () => {
    /*
     * An unset `REDIS_URL` is a choice — a preview deploy, a local checkout —
     * not a failure. Warning about it would train everyone to ignore the
     * message that matters.
     */
    delete process.env.REDIS_URL;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rateLimit } = await import("./redis");

    await rateLimit("test", 10, 60);
    expect(error).not.toHaveBeenCalled();
  });

  it("allows the request, and says so once, when Redis is unreachable", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rateLimit } = await import("./redis");

    // Fails open — this is the property a buyer depends on.
    expect(await rateLimit("test", 10, 60)).toEqual(OK);

    // And says so. Once: the second call is inside the cold window, and a log
    // line per request would bury the one that mattered.
    await rateLimit("test", 10, 60);
    await rateLimit("test", 10, 60);

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/failing open/i);
  }, 20_000);
});

/**
 * Giving a spent unit back.
 *
 * `refundRateLimit` exists so a limit can charge for some outcomes and not
 * others — specifically, so guessing a coupon code costs and holding a real
 * one does not. Charge-first is what closes the burst hole a peek-then-charge
 * design had, so the properties worth pinning are that a refund undoes exactly
 * one charge on the same counter, that it will not touch a bucket that is not
 * there, and that it fails open.
 */
describe("refundRateLimit", () => {
  const original = process.env.REDIS_URL;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
  });

  it("is a no-op when Redis is not configured", async () => {
    delete process.env.REDIS_URL;
    const { refundRateLimit } = await import("./redis");

    await expect(refundRateLimit("test", 60)).resolves.toBeUndefined();
  });

  it("returns exactly the unit rateLimit charged", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";

    const store = new Map<string, number>();
    const client = {
      incr: vi.fn(async (k: string) => {
        const next = (store.get(k) ?? 0) + 1;
        store.set(k, next);
        return next;
      }),
      decr: vi.fn(async (k: string) => {
        const next = (store.get(k) ?? 0) - 1;
        store.set(k, next);
        return next;
      }),
      exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
      expire: vi.fn(async () => 1),
    };
    vi.doMock("redis", () => ({
      createClient: () => ({
        ...client,
        on: vi.fn(),
        connect: vi.fn(async () => undefined),
      }),
    }));

    const { rateLimit, refundRateLimit } = await import("./redis");

    // Fill the budget, refund one, and the next charge must fit again —
    // the honest-buyer loop: pay, resolve the code, get the unit back.
    await rateLimit("k", 2, 60);
    await rateLimit("k", 2, 60);
    expect((await rateLimit("k", 2, 60)).allowed).toBe(false);
    await refundRateLimit("k", 60);
    // The refused charge above also incremented, so two refunds are owed
    // before a new one fits; the point is each refund is exactly one unit.
    await refundRateLimit("k", 60);
    expect((await rateLimit("k", 2, 60)).allowed).toBe(true);
  });

  it("does not create a counter that was never charged", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";

    const store = new Map<string, number>();
    const client = {
      incr: vi.fn(async () => 1),
      decr: vi.fn(async (k: string) => {
        const next = (store.get(k) ?? 0) - 1;
        store.set(k, next);
        return next;
      }),
      exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
      expire: vi.fn(async () => 1),
    };
    vi.doMock("redis", () => ({
      createClient: () => ({
        ...client,
        on: vi.fn(),
        connect: vi.fn(async () => undefined),
      }),
    }));

    const { refundRateLimit } = await import("./redis");

    /*
     * The window-rollover case: the bucket the charge went into has expired
     * by the time the refund arrives. Decrementing the new bucket would give
     * this window's caller next window's budget, so the refund must land
     * nowhere instead.
     */
    await refundRateLimit("never-charged", 60);
    expect(client.decr).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
});
