import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * A database on this machine, for development and for tests that write.
 *
 * `@neondatabase/serverless` speaks Neon's HTTP protocol rather than the
 * Postgres wire protocol, so it cannot talk to an ordinary Postgres container.
 * That is why, until now, the only database this app could reach was the
 * production one — and why no test had ever placed an order: doing so would
 * have written real rows and claimed a real invoice number.
 * `scripts/scenarios/up.sh` runs a local proxy that bridges the two, and this
 * points the driver at it.
 *
 * **Keyed on the connection string being local, not on an environment flag.**
 * A flag can be set by mistake in production; a hostname cannot lie about
 * where the database is. If `DATABASE_URL` names this machine, the proxy is
 * the only thing that could serve it, so honouring it is unambiguous — and if
 * it names Neon, nothing here runs at all.
 */
function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

let proxyConfigured = false;

function createDb(url: string) {
  if (isLocalUrl(url) && !proxyConfigured) {
    neonConfig.fetchEndpoint =
      process.env.NEON_LOCAL_PROXY ?? "http://localhost:54330/sql";
    neonConfig.useSecureWebSocket = false;
    neonConfig.poolQueryViaFetch = true;
    proxyConfigured = true;
  }
  return drizzle(neon(url), { schema });
}

// Lazy so `next build` doesn't need a live connection string.
let primary: ReturnType<typeof createDb> | null = null;
let replica: ReturnType<typeof createDb> | null = null;

/**
 * Every replica connection string that is configured, in Neon's own naming.
 *
 * `READ_REPLICA_URL` is what their Drizzle guide uses, and `_1`, `_2`, … is
 * the convention it gives for more than one. `DATABASE_URL_REPLICA` is
 * accepted too because it shipped first and removing it would silently send
 * an already-deployed environment back to the primary.
 */
function replicaUrls(): string[] {
  const numbered = Array.from({ length: 8 }, (_, i) =>
    process.env[`READ_REPLICA_URL_${i + 1}`],
  );
  return [
    process.env.READ_REPLICA_URL,
    process.env.DATABASE_URL_REPLICA,
    ...numbered,
  ].filter((url): url is string => Boolean(url));
}

/**
 * Which replica this instance talks to, chosen once and kept.
 *
 * Picked per process rather than per query on purpose. Neon suspends an
 * endpoint that goes idle, and a cold start costs far more than the imbalance
 * this avoids — round-robin across three replicas from every instance keeps
 * all three lukewarm and none of them warm. Pinning means one instance's
 * traffic lands on one endpoint and keeps it awake, while the spread across
 * many instances still uses every replica.
 */
let chosen: string | null = null;

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
 * WHY NOT `withReplicas()`
 * Neon's Drizzle guide reaches for `drizzle-orm`'s `withReplicas(primary,
 * [read])`, which routes every read to a replica and every write to the
 * primary automatically, with `db.$primary()` to opt out. That is the wrong
 * default here, and the reason is the list above: `inventory.ts` reading a
 * stock count, `stripe-webhooks.ts` reading the order it is about to settle,
 * and `session.ts` reading the staff allowlist are all `select`s, so all
 * three would go to a replica unless someone remembered `$primary()` on each.
 * Forgetting is silent, and it fails as overselling or a webhook redoing
 * settled work rather than as an error.
 *
 * This inverts it: the primary is what you get, and reaching for a replica is
 * a deliberate call in a module the test below allowlists. Forgetting is
 * merely slower.
 *
 * Falls back to the primary when no replica is configured, so this is safe to
 * deploy before the replicas exist and safe to roll back to by removing an
 * environment variable.
 */
export function getReadDb() {
  if (!chosen) {
    const urls = replicaUrls();
    const pick = urls[Math.floor(Math.random() * urls.length)];
    if (!pick) return getDb();
    chosen = pick;
  }
  if (!replica) replica = createDb(chosen);
  return replica;
}

export { schema };
