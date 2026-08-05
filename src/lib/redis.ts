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

export function redisConfigured() {
  return Boolean(process.env.REDIS_URL);
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
      next.on("error", () => {
        coldUntil = Date.now() + COLD_MS;
      });

      await next.connect();
      client = next;
      return next;
    } catch {
      coldUntil = Date.now() + COLD_MS;
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
  const redis = await connect();
  if (!redis) return fallback;
  try {
    return await fn(redis);
  } catch {
    coldUntil = Date.now() + COLD_MS;
    return fallback;
  }
}

/* -------------------------------------------------------------------------- */
/*  Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

export type RateVerdict = { allowed: boolean; remaining: number };

/**
 * A fixed window per key. Coarser than a sliding log and far cheaper — two
 * commands, no sorted set — and for "stop one address hammering the tracking
 * endpoint" the extra precision buys nothing.
 *
 * Fails open. A rate limiter that blocks real buyers because its own backend
 * is down has done more damage than the traffic it was meant to stop.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateVerdict> {
  return withRedis(
    async (redis) => {
      const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
      const full = `sailo:rl:${key}:${bucket}`;

      const count = await redis.incr(full);
      if (count === 1) await redis.expire(full, windowSeconds);

      return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
    },
    { allowed: true, remaining: limit },
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

/** For the health check — reports whether Redis is actually answering. */
export async function redisPing(): Promise<{ ok: boolean; ms: number | null }> {
  if (!redisConfigured()) return { ok: false, ms: null };
  const started = Date.now();
  const pong = await withRedis((redis) => redis.ping(), null);
  return { ok: pong === "PONG", ms: pong === "PONG" ? Date.now() - started : null };
}
