import { describe, expect, it } from "vitest";
import {
  AUTO_DISABLE_AFTER,
  CLAIM_LEASE_MS,
  MAX_ATTEMPTS,
  MAX_CONCURRENT_ENDPOINTS,
  MAX_PER_ENDPOINT,
  MAX_PER_TICK,
  RETRY_BACKOFF_MS,
  attemptsExhausted,
  backoffFor,
} from "./policy";

/**
 * The retry schedule, as arithmetic.
 *
 * These numbers decide whether a seller's CRM ever receives an order, and until this
 * file they had never been asserted — not because nobody cared, but because reaching
 * them meant mocking a database, a signer and an HTTP client. That is the argument for
 * pulling them out of the 505-line module they were buried in: a rule that cannot be
 * tested cheaply does not get tested.
 *
 * No mocks below. That is the point.
 */

describe("the retry schedule", () => {
  it("is dense at the start and spread out at the end", () => {
    // 1m, 5m, 30m, 2h, 12h — dense enough to ride out a deploy, spread out enough to
    // survive an outage lasting a working day.
    expect([...RETRY_BACKOFF_MS]).toEqual([
      60_000,
      5 * 60_000,
      30 * 60_000,
      2 * 3_600_000,
      12 * 3_600_000,
    ]);
  });

  it("is monotonically increasing, because a schedule that dips retries harder later", () => {
    for (let i = 1; i < RETRY_BACKOFF_MS.length; i++) {
      expect(RETRY_BACKOFF_MS[i]!).toBeGreaterThan(RETRY_BACKOFF_MS[i - 1]!);
    }
  });

  it("spans about fifteen hours in total", () => {
    const total = RETRY_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0);

    expect(total / 3_600_000).toBeCloseTo(14.6, 1);
  });

  /*
   * The invariant tying the two constants together. `MAX_ATTEMPTS` is derived, and if
   * somebody ever hardcodes it, a schedule of five waits with a cap of five attempts
   * would abandon deliveries one attempt early — silently, since nothing would fail.
   */
  it("allows one more attempt than it has waits", () => {
    expect(MAX_ATTEMPTS).toBe(RETRY_BACKOFF_MS.length + 1);
    expect(MAX_ATTEMPTS).toBe(6);
  });
});

describe("backoffFor", () => {
  /*
   * 1-based, because the claim increments `attempt` before returning it — so the first
   * POST of a delivery is attempt 1 and asks for the first wait. An off-by-one here
   * would either skip the one-minute retry or repeat the twelve-hour one.
   */
  it("maps the first attempt to the first wait", () => {
    expect(backoffFor(1)).toBe(60_000);
  });

  it("walks the table in order", () => {
    expect(backoffFor(2)).toBe(5 * 60_000);
    expect(backoffFor(3)).toBe(30 * 60_000);
    expect(backoffFor(4)).toBe(2 * 3_600_000);
    expect(backoffFor(5)).toBe(12 * 3_600_000);
  });

  /*
   * Past the end of the table it holds at the longest wait rather than reading
   * `undefined`. `now + undefined` is `Invalid Date`, and a `nextAttemptAt` that
   * Postgres rejects — or worse, one set to now — turns an exhausted delivery into a
   * hot loop that reposts every tick for ever.
   */
  it("holds at the longest wait beyond the end of the table", () => {
    expect(backoffFor(6)).toBe(12 * 3_600_000);
    expect(backoffFor(99)).toBe(12 * 3_600_000);
  });

  it("never returns undefined or NaN, whatever it is asked", () => {
    for (const attempt of [0, 1, 5, 6, 7, 100, -1]) {
      const backoff = backoffFor(attempt);
      expect(Number.isFinite(backoff), `attempt ${attempt}`).toBe(true);
      expect(backoff).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("attemptsExhausted", () => {
  it("is false while attempts remain", () => {
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      expect(attemptsExhausted(attempt), `attempt ${attempt}`).toBe(false);
    }
  });

  it("is true on the last attempt, not after it", () => {
    // The check runs *after* the attempt was made, so attempt 6 of 6 is the end.
    expect(attemptsExhausted(MAX_ATTEMPTS)).toBe(true);
  });

  it("stays true if a row somehow overshoots", () => {
    expect(attemptsExhausted(MAX_ATTEMPTS + 5)).toBe(true);
  });
});

describe("the ceilings", () => {
  /*
   * The lease must outlast both the POST and the cron interval, or a row still being
   * posted becomes due again and a second tick posts it a second time — a duplicate
   * order landing in a seller's CRM.
   */
  it("hides a claimed row for longer than a tick", () => {
    const cronIntervalMs = 5 * 60_000;

    expect(CLAIM_LEASE_MS).toBeGreaterThanOrEqual(cronIntervalMs);
  });

  it("examines more rows per tick than it will send to any one endpoint", () => {
    // Otherwise a single busy endpoint starves every other shop's deliveries.
    expect(MAX_PER_TICK).toBeGreaterThan(MAX_PER_ENDPOINT);
  });

  it("opens far fewer sockets than the rows it may examine", () => {
    expect(MAX_CONCURRENT_ENDPOINTS).toBeLessThan(MAX_PER_TICK);
  });

  /*
   * Disabling has to take more consecutive failures than one tick can produce, or a
   * single bad afternoon at the receiving end switches a seller's integration off.
   */
  it("needs more consecutive failures to disable than one tick can deliver", () => {
    expect(AUTO_DISABLE_AFTER).toBeGreaterThan(MAX_PER_ENDPOINT);
  });
});
