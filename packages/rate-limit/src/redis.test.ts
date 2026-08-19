import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The limiter's behaviour when its own backend is gone.
 *
 * Failing open is the right *default* and is deliberate — a rate limiter that
 * blocks real buyers because a cache went down has cost more than the traffic
 * it stopped. What was wrong was that it happened *silently*: every ceiling in
 * the app — signup, sign-in, checkout, the affiliate form, the download route,
 * the invoice PDF, better-auth's own endpoints — disappears at the same
 * moment, and the only outward sign is an absence of throttling, which looks
 * exactly like not being attacked.
 *
 * Decision B (`RELEASE-PLAN-2026-08.md` §0.6) named three kinds of endpoint
 * where open is the wrong trade — public writes, anything spending money or
 * quota, and existence oracles — so the default is now a default rather than
 * the only behaviour, and `reason` is what lets a surface tell "we measured you
 * and refused" from "we could not measure anything".
 *
 * These pin the properties that make an outage survivable: it still fails open
 * by default, it fails closed when asked, an *unconfigured* environment is
 * neither, and it says so once rather than either never or on every request.
 */

const OK = { allowed: true, remaining: 10, reason: "unconfigured" };

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
    expect(await rateLimit("test", 10, 60)).toEqual({
      allowed: true,
      remaining: 10,
      reason: "outage",
    });

    // And says so. Once: the second call is inside the cold window, and a log
    // line per request would bury the one that mattered.
    await rateLimit("test", 10, 60);
    await rateLimit("test", 10, 60);

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/fails? open/i);
  }, 20_000);

  /*
   * DECISION B
   *
   * Three kinds of endpoint may not lose their ceiling to a cache outage:
   * unauthenticated writes that create rows, anything spending money or a
   * shared quota, and anything whose answer says whether something exists.
   * Each call site names which it is; the limiter only has to honour it.
   */
  it("refuses when the caller asked to fail closed and Redis is down", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rateLimit } = await import("./redis");

    const verdict = await rateLimit("test", 10, 60, { onOutage: "closed" });
    expect(verdict.allowed).toBe(false);
    /*
     * And it says *why*, because a fail-closed refusal is not an answer about
     * the request. A surface that renders this as "that code is invalid" or
     * "no account with that address" has told the caller something nobody
     * checked — rule 5, and the reason `over` and `outage` are separate values.
     */
    expect(verdict.reason).toBe("outage");
  }, 20_000);

  it("does not fail closed in an environment that has no limiter", async () => {
    /*
     * An unset `REDIS_URL` is a preview deploy, a local checkout, or the
     * scenario suite — a deployment with no ceilings, not a ceiling that broke.
     * Refusing every public write in one of those would break development for
     * an outage that has not happened.
     */
    delete process.env.REDIS_URL;
    const { rateLimit } = await import("./redis");

    const verdict = await rateLimit("test", 10, 60, { onOutage: "closed" });
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe("unconfigured");
  });

  it("tells a real refusal from an outage", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    let count = 0;
    vi.doMock("redis", () => ({
      createClient: () => ({
        incr: vi.fn(async () => ++count),
        expire: vi.fn(async () => 1),
        on: vi.fn(),
        connect: vi.fn(async () => undefined),
      }),
    }));
    const { rateLimit } = await import("./redis");

    expect((await rateLimit("k", 1, 60)).reason).toBe("under");
    // Over the ceiling, measured. This one is an answer, and may be rendered
    // as one — under either policy, because the backend was reachable.
    const over = await rateLimit("k", 1, 60, { onOutage: "closed" });
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe("over");
  });
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
