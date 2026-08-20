import "server-only";
import { createClient, type RedisClientType } from "redis";

/**
 * Redis, and the rule that governs every use of it here: it is an accelerator,
 * never a source of truth.
 *
 * Postgres holds the shop. Redis holds things that are cheap to lose — a
 * counter that hasn't been flushed yet, a rate-limit window, a warm value.
 * If it's slow, unreachable, or simply not configured, every caller falls
 * back to what it did before and the shop keeps selling. A storefront that
 * goes down because a cache went down is a worse system than one with no
 * cache at all.
 *
 * That's why nothing in this file throws at its callers.
 */

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;

/** Set once a connection has failed, so every request doesn't retry the wait. */
let coldUntil = 0;
const COLD_MS = 30_000;

/**
 * Whether the last thing we said about Redis was that it was down.
 *
 * Going cold is the single most consequential thing that can happen quietly in
 * this file: every rate limit in the app fails open, so the ceilings on
 * signup, checkout, the affiliate form, the download route and better-auth all
 * disappear at once — and the only outward sign is the absence of throttling,
 * which looks exactly like not being attacked. This makes the transition say
 * so, once each way rather than once per request, so a log full of it does not
 * become the thing nobody reads.
 */
let reportedCold = false;

function goCold(reason: string) {
  coldUntil = Date.now() + COLD_MS;
  if (reportedCold) return;
  reportedCold = true;
  console.error(
    `[sailo] redis is unreachable (${reason}) — every rate limit that fails ` +
      `open has now vanished, and every one that fails closed is refusing, ` +
      `until it recovers`,
  );
}

function goWarm() {
  if (!reportedCold) return;
  reportedCold = false;
  console.warn("[sailo] redis is answering again — rate limits are enforced");
}

async function connect(): Promise<RedisClientType | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (Date.now() < coldUntil) return null;

  if (client?.isReady) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const next: RedisClientType = createClient({
        url,
        socket: {
          // A serverless invocation can't wait around; failing fast and using
          // Postgres is better than holding the request open.
          connectTimeout: 3_000,
          reconnectStrategy: (retries) =>
            retries > 3 ? false : Math.min(retries * 200, 1_000),
        },
      });

      // Without a listener, node-redis escalates socket errors to an
      // uncaught exception and takes the process with it.
      next.on("error", (error: unknown) => {
        goCold(error instanceof Error ? error.message : "socket error");
      });

      await next.connect();
      client = next;
      goWarm();
      return next;
    } catch (error) {
      goCold(error instanceof Error ? error.message : "connect failed");
      client = null;
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

/**
 * Runs `fn` against Redis, or returns `fallback` if Redis isn't there.
 *
 * Callers never see an error and never see a promise that hangs — an
 * unreachable cache resolves to the fallback and the request carries on.
 */
export async function withRedis<T>(
  fn: (redis: RedisClientType) => Promise<T>,
  fallback: T,
): Promise<T> {
  return (await attemptRedis(fn, fallback)).value;
}

/**
 * `withRedis`, plus whether the answer came from Redis or from the fallback.
 *
 * The distinction only one caller needs, and it needs it badly: a limiter that
 * fails closed has to tell "the ceiling refused you" from "there was no ceiling
 * to ask". Everything else in this file is happier not knowing.
 *
 * `reached: false` covers both a cold backend and one that was never configured
 * — `configured()` is what separates those, because they mean opposite things.
 */
async function attemptRedis<T>(
  fn: (redis: RedisClientType) => Promise<T>,
  fallback: T,
): Promise<{ value: T; reached: boolean }> {
  const redis = await connect();
  if (!redis) return { value: fallback, reached: false };
  try {
    return { value: await fn(redis), reached: true };
  } catch (error) {
    goCold(error instanceof Error ? error.message : "command failed");
    return { value: fallback, reached: false };
  }
}

/** Whether a limiter is meant to exist in this environment at all. */
function configured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

/**
 * A second connection, for the one Redis feature the shared client cannot
 * carry: pub/sub. A connection that SUBSCRIBEs leaves command mode, so the
 * rate limits and counters above would stop working on it — the protocol
 * forces the split, not us.
 *
 * Callers own what they're given — they add their own `error` listener to
 * decide what a dead subscription means for them, and they `destroy()` it
 * when the stream it feeds closes. Returns null under exactly
 * the conditions `withRedis` falls back — not configured, or cold — so a
 * caller holding null knows push delivery is off and can say so instead of
 * pretending.
 */
export async function createSubscriber(): Promise<RedisClientType | null> {
  const base = await connect();
  if (!base) return null;
  try {
    const sub: RedisClientType = base.duplicate();
    // The same guard the shared client has: without a listener, a socket
    // error escalates to an uncaught exception and takes the process along.
    sub.on("error", (error: unknown) => {
      goCold(error instanceof Error ? error.message : "subscriber error");
    });
    await sub.connect();
    return sub;
  } catch (error) {
    goCold(error instanceof Error ? error.message : "subscriber failed");
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Why a caller was let through or turned away.
 *
 * Three answers, not two, because "over the ceiling" and "there is no ceiling
 * right now" are different facts and one caller acts on the difference.
 *
 * - `under` — Redis answered and the budget had room.
 * - `over` — Redis answered and the budget did not. A real refusal.
 * - `outage` — Redis is configured and unreachable. **Not** a refusal on the
 *   merits: nothing was measured. Whatever a surface says about this must read
 *   as "ask again shortly", never as an answer about the thing being asked for.
 *   Rule 5: throttled is unknown, never a negative answer.
 * - `unconfigured` — there is no limiter in this environment. A preview deploy,
 *   a local checkout, the scenario suite. Nothing failed, so nothing fails
 *   closed; a limiter that was never installed cannot be said to have gone down.
 */
export type RateReason = "under" | "over" | "outage" | "unconfigured";

export type RateVerdict = {
  allowed: boolean;
  remaining: number;
  reason: RateReason;
  /**
   * Whole seconds until this key's window rolls over and the budget is whole
   * again. Always between 1 and `windowSeconds`.
   *
   * A fixed window knows this exactly — the bucket is `now / window`, so the
   * next one starts at a computable instant — and it is worth returning because
   * the caller's alternative is to assume the worst. A client told only "you
   * are over a per-minute limit" has to wait a minute; a client told "wait 3
   * seconds" waits three. At the moment a budget is exhausted those differ by
   * up to sixty times, and that gap is throughput an integration never gets
   * back.
   *
   * On an outage or an unconfigured deployment this is the full window, which
   * is the honest answer: nothing is known about when a budget nobody is
   * counting would recover.
   */
  resetSeconds: number;
};

/**
 * What a caller wants when Redis is not answering.
 *
 * `open` is the default and stays the default: a rate limiter that blocks real
 * buyers because its own backend is down has done more damage than the traffic
 * it was meant to stop, and that is the right trade for the overwhelming
 * majority of the ceilings in this app.
 *
 * `closed` is for the three kinds of endpoint where it is not (Decision B in
 * `RELEASE-PLAN-2026-08.md` §0.6), and each call site says which it is beside
 * the call:
 *
 *   1. **Public writes.** Unauthenticated requests that create rows —
 *      checkout-recovery sessions, waitlist joins, testimonial submissions. An
 *      hour of no ceiling on these is an hour of unbounded rows from anybody.
 *   2. **Anything that spends money or quota.** A send path with no ceiling
 *      burns the Resend quota, and that quota also carries buyers' receipts —
 *      so an open failure here takes down transactional mail as collateral.
 *   3. **Existence oracles.** Invite, password reset, coupon guessing. The
 *      ceiling is the only thing making enumeration expensive; without it the
 *      endpoint answers the question it exists to refuse.
 */
export type OutagePolicy = "open" | "closed";

/**
 * A fixed window per key. Coarser than a sliding log and far cheaper — two
 * commands, no sorted set — and for "stop one address hammering the tracking
 * endpoint" the extra precision buys nothing.
 *
 * Fails open unless the caller says otherwise; see `OutagePolicy` for when it
 * should not, and read `verdict.reason` rather than `verdict.allowed` when
 * deciding what to *say* — a refusal under `outage` is not an answer about the
 * request, and copy that treats it as one is a lie about a coupon, an account
 * or a slot.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  opts: { onOutage?: OutagePolicy } = {},
): Promise<RateVerdict> {
  /*
   * Computed once, from the same clock reading the bucket is derived from.
   *
   * Reading `Date.now()` a second time inside the callback would be a different
   * instant, and a reset that belongs to a neighbouring bucket is worse than no
   * reset at all — it tells a client to retry while the budget is still spent.
   */
  const windowMs = windowSeconds * 1000;
  const now = Date.now();
  const resetSeconds = Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000));

  const { value, reached } = await attemptRedis<RateVerdict>(
    async (redis) => {
      const bucket = Math.floor(now / windowMs);
      const full = `sailo:rl:${key}:${bucket}`;

      const count = await redis.incr(full);
      if (count === 1) await redis.expire(full, windowSeconds);

      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        reason: count <= limit ? "under" : "over",
        resetSeconds,
      };
    },
    { allowed: true, remaining: limit, reason: "outage", resetSeconds },
  );

  if (reached) return value;

  /*
   * No backend. Which of the two "no backend" cases this is decides everything:
   * an unset `REDIS_URL` is a deployment with no limiter, and refusing every
   * public write in it would break local development and the scenario suite for
   * a failure that has not happened.
   */
  if (!configured()) {
    return { allowed: true, remaining: limit, reason: "unconfigured", resetSeconds: windowSeconds };
  }

  return opts.onOutage === "closed"
    ? { allowed: false, remaining: 0, reason: "outage", resetSeconds: windowSeconds }
    : { allowed: true, remaining: limit, reason: "outage", resetSeconds: windowSeconds };
}

/**
 * Gives one spent unit back.
 *
 * For limits where only *some* outcomes should cost — the shape you want
 * whenever the thing being rationed is attempts at a secret. Charging every
 * attempt rations the legitimate user too: they have one code and they use it
 * repeatedly. Charging only the failures rations exactly the behaviour that
 * separates guessing from using.
 *
 * The order matters, and it is charge-first: the caller pays with `rateLimit`,
 * does the work, and refunds here if the attempt turns out to have been
 * legitimate. The inviting alternative — peek at the counter, work, then
 * charge on failure — has a hole exactly where this limit is aimed: every
 * request in a concurrent burst peeks before any of them has charged, so all
 * of them pass a ceiling that should have stopped all but the first few.
 * Paying up front closes that, because `INCR` is atomic and the verdict comes
 * from its return value. What it costs is a transient unit held while a
 * legitimate attempt is in flight, returned milliseconds later — visible only
 * to someone who fills the whole budget with concurrent requests, and
 * self-healing on their next one.
 *
 * Refunds only a bucket that still exists. The one way a refund can misfire is
 * the window rolling over between the charge and here — decrementing the *new*
 * bucket would hand next window's budget to this window's caller, so a missing
 * bucket means the charge already expired and there is nothing to give back.
 *
 * Fails open, like `rateLimit`: a lost refund costs one unit for the rest of
 * the window, which is the cheap side of that trade.
 */
export async function refundRateLimit(
  key: string,
  windowSeconds: number,
): Promise<void> {
  await withRedis(
    async (redis) => {
      // The same bucket `rateLimit` charged, so the two see one counter.
      const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
      const full = `sailo:rl:${key}:${bucket}`;
      if (await redis.exists(full)) await redis.decr(full);
      return undefined;
    },
    undefined,
  );
}

/* -------------------------------------------------------------------------- */
/*  Buffered counters                                                          */
/* -------------------------------------------------------------------------- */

const CLICKS_KEY = "sailo:affiliate-clicks";

/**
 * Buffers an affiliate click.
 *
 * Every click was a row UPDATE — the one write on the public side that scales
 * with traffic rather than with orders, and the first thing to hurt when a
 * popular affiliate posts a link. Counting in Redis and folding into Postgres
 * on a schedule turns thousands of writes into one.
 *
 * Returns false when Redis isn't available, so the caller writes directly and
 * the count stays correct either way.
 */
export async function bufferAffiliateClick(affiliateId: string): Promise<boolean> {
  return withRedis(async (redis) => {
    await redis.hIncrBy(CLICKS_KEY, affiliateId, 1);
    return true;
  }, false);
}

/**
 * Takes everything buffered so far and hands it to the caller to persist.
 *
 * The key is renamed before it's read, so clicks arriving mid-flush land in a
 * fresh key rather than being counted and then thrown away. If the caller
 * fails to persist, the counts are gone — which is the right trade for a
 * click counter and would not be for money.
 */
export async function drainAffiliateClicks(): Promise<Record<string, number>> {
  return withRedis(async (redis) => {
    const staging = `${CLICKS_KEY}:flushing:${Date.now()}`;
    try {
      await redis.rename(CLICKS_KEY, staging);
    } catch {
      // Nothing buffered — RENAME on a missing key is an error, not a problem.
      return {};
    }

    const raw = await redis.hGetAll(staging);
    await redis.del(staging);

    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(raw)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) out[id] = n;
    }
    return out;
  }, {});
}
