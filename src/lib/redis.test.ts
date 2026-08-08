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
 * Reading a budget without spending from it.
 *
 * `rateLimitPeek` exists so a limit can charge for some outcomes and not
 * others — specifically, so guessing a coupon code costs and using a real one
 * does not. The properties worth pinning are that it does not increment, that
 * it reads the same counter `rateLimit` writes, and that it fails open.
 */
describe("rateLimitPeek", () => {
  const original = process.env.REDIS_URL;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
  });

  it("allows when Redis is not configured", async () => {
    delete process.env.REDIS_URL;
    const { rateLimitPeek } = await import("./redis");

    expect(await rateLimitPeek("test", 10, 60)).toEqual(OK);
  });

  it("reads without incrementing, and reads what rateLimit wrote", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";

    // One shared counter, so a peek after N writes must see exactly N.
    const store = new Map<string, number>();
    const client = {
      incr: vi.fn(async (k: string) => {
        const next = (store.get(k) ?? 0) + 1;
        store.set(k, next);
        return next;
      }),
      expire: vi.fn(async () => 1),
      get: vi.fn(async (k: string) => store.get(k) ?? null),
    };
    vi.doMock("redis", () => ({
      createClient: () => ({
        ...client,
        on: vi.fn(),
        connect: vi.fn(async () => undefined),
      }),
    }));

    const { rateLimit, rateLimitPeek } = await import("./redis");

    await rateLimit("k", 3, 60);
    await rateLimit("k", 3, 60);
    const before = [...store.values()];

    const peek = await rateLimitPeek("k", 3, 60);
    // Two spent of three, so there is room for one more and nothing was taken.
    expect(peek.allowed).toBe(true);
    expect(peek.remaining).toBe(1);
    expect([...store.values()]).toEqual(before);

    // The third spends the budget; the peek after it must refuse.
    await rateLimit("k", 3, 60);
    expect((await rateLimitPeek("k", 3, 60)).allowed).toBe(false);
  });
});
