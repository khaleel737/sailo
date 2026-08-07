import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb(url: string) {
  return drizzle(neon(url), { schema });
}

// Lazy so `next build` doesn't need a live connection string.
let primary: ReturnType<typeof createDb> | null = null;
let replica: ReturnType<typeof createDb> | null = null;

/**
 * The database of record. Every write, and every read that a write depends on.
 */
export function getDb() {
  if (!primary) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    primary = createDb(url);
  }
  return primary;
}

/**
 * A Neon read replica, for queries that may safely see the recent past.
 *
 * WHAT THIS IS FOR
 * The heavy reads in this codebase are aggregates: a seller's dashboard scans
 * their visits and orders over a window and groups them, and `/hq` does the
 * same across every shop. Those run on request, they are not cached (the
 * numbers move constantly, so caching them would only mean showing a stale
 * total), and they are the reads that grow with the size of the business
 * rather than with one shop's traffic. Sending them to a replica keeps that
 * work off the endpoint that has to stay fast for checkout.
 *
 * WHAT IT IS NOT FOR — and this is the part that matters
 * A replica lags the primary. Usually milliseconds, occasionally much more,
 * and there is no upper bound you can rely on. So it must never serve a read
 * that a write is about to depend on. Concretely, in this codebase:
 *
 *   - stock, in `inventory.ts`. Reading a stale count is how two buyers are
 *     sold the last one.
 *   - anything in `actions/orders.ts` on the way to creating an order.
 *   - `stripe-webhooks.ts`, which reads an order it is about to settle and
 *     whose idempotency depends on seeing its own previous write.
 *   - sessions and the `/hq` staff allowlist. A revoked session that a
 *     replica has not heard about yet is an authorisation hole.
 *   - anything reading a row it just wrote in the same request.
 *
 * The rule is simple enough to hold in your head: if the answer decides
 * whether a write happens, it comes from the primary.
 *
 * Falls back to the primary when `DATABASE_URL_REPLICA` is unset, so this is
 * safe to deploy before the replica exists and safe to roll back to by
 * removing one environment variable.
 */
export function getReadDb() {
  const url = process.env.DATABASE_URL_REPLICA;
  if (!url) return getDb();
  if (!replica) replica = createDb(url);
  return replica;
}

export { schema };
