import "server-only";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  shops,
  user,
  webhookDeliveries,
  webhookEndpoints,
} from "@/db/schema";
import { maybeRow } from "@/lib/invariant";
import { sendSellerWebhookDisabled } from "@/lib/email/seller-messages";
import { postWebhook } from "./post";
import { signWebhook } from "./signature";

/**
 * Draining the delivery queue, and the four decisions that shape it.
 *
 * **The row is the state.** Nothing here holds a list in memory across an
 * await that matters. A tick that dies takes nothing with it.
 *
 * **The claim is a lease, not a status.** One conditional UPDATE increments
 * `attempt` and pushes `nextAttemptAt` into the future; only the caller whose
 * UPDATE returns a row is allowed to POST. Two overlapping ticks therefore
 * claim disjoint sets, and a tick killed mid-POST leaves a row that becomes
 * due again rather than one stranded in a `sending` state for ever.
 *
 * **One endpoint is never posted to concurrently.** Each endpoint's due rows
 * are handled in sequence, and different endpoints run alongside each other up
 * to `MAX_CONCURRENT_ENDPOINTS`. A shop importing two hundred orders therefore
 * does not open two hundred sockets to one Zapier hook, and events still
 * arrive at each endpoint in roughly the order they happened.
 *
 * **A failing endpoint stops costing us the tick.** The first failure for an
 * endpoint ends that endpoint's batch, so a dead host is tried once per tick
 * rather than ten times.
 */

/* -------------------------------------------------------------------------- */
/*  The numbers                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 1m, 5m, 30m, 2h, 12h — then the delivery is abandoned.
 *
 * Six attempts spanning roughly fifteen hours, which is the shape every
 * webhook system converges on: dense enough at the start to ride out a deploy
 * or a restart, spread out enough at the end to survive an outage that lasts a
 * working day, and finite because an event nobody has accepted by tomorrow is
 * not one their CRM still wants.
 */
const RETRY_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  12 * 3_600_000,
] as const;

const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

/**
 * How long a claimed row is hidden from other ticks.
 *
 * Longer than the POST timeout by a wide margin and longer than the cron
 * interval, so the only thing that can make a leased row due again is the
 * process that claimed it having died.
 */
const CLAIM_LEASE_MS = 5 * 60_000;

/** Consecutive failures before we stop delivering and tell the seller. */
const AUTO_DISABLE_AFTER = 20;

/** Rows examined per tick. The cron runs every five minutes. */
const MAX_PER_TICK = 200;

/** Rows one endpoint may receive in a single tick. */
const MAX_PER_ENDPOINT = 10;

/** Endpoints posted to at once. */
const MAX_CONCURRENT_ENDPOINTS = 8;

export type QueueRun = {
  attempted: number;
  delivered: number;
  failed: number;
  abandoned: number;
  disabled: number;
};

/* -------------------------------------------------------------------------- */
/*  One tick                                                                   */
/* -------------------------------------------------------------------------- */

export async function runWebhookQueue(opts?: { now?: Date }): Promise<QueueRun> {
  const db = getDb();
  const now = opts?.now ?? new Date();
  const run: QueueRun = {
    attempted: 0,
    delivered: 0,
    failed: 0,
    abandoned: 0,
    disabled: 0,
  };

  const due = await db
    .select({
      id: webhookDeliveries.id,
      endpointId: webhookDeliveries.endpointId,
      event: webhookDeliveries.event,
      payload: webhookDeliveries.payload,
      url: webhookEndpoints.url,
      secret: webhookEndpoints.secret,
      isActive: webhookEndpoints.isActive,
    })
    .from(webhookDeliveries)
    .innerJoin(
      webhookEndpoints,
      eq(webhookEndpoints.id, webhookDeliveries.endpointId),
    )
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        lte(webhookDeliveries.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(webhookDeliveries.createdAt))
    .limit(MAX_PER_TICK);

  if (due.length === 0) return run;

  /*
   * Grouped by endpoint, order preserved. `due` is already oldest-first, so
   * each group comes out oldest-first too and the per-endpoint sequence below
   * delivers in the order the events happened.
   */
  const byEndpoint = new Map<string, typeof due>();
  for (const row of due) {
    const group = byEndpoint.get(row.endpointId);
    if (group) {
      if (group.length < MAX_PER_ENDPOINT) group.push(row);
    } else {
      byEndpoint.set(row.endpointId, [row]);
    }
  }

  const groups = [...byEndpoint.values()];
  const results = await inBatches(groups, MAX_CONCURRENT_ENDPOINTS, (group) =>
    drainEndpoint(group, now),
  );

  for (const result of results) {
    run.attempted += result.attempted;
    run.delivered += result.delivered;
    run.failed += result.failed;
    run.abandoned += result.abandoned;
    run.disabled += result.disabled;
  }

  return run;
}

/** One due delivery joined to the endpoint it is bound for. */
type EndpointRow = {
  id: string;
  endpointId: string;
  event: string;
  payload: unknown;
  url: string;
  secret: string;
  isActive: boolean;
};

/** Every due delivery for one endpoint, in sequence, stopping at the first failure. */
async function drainEndpoint(rows: EndpointRow[], now: Date): Promise<QueueRun> {
  const run: QueueRun = {
    attempted: 0,
    delivered: 0,
    failed: 0,
    abandoned: 0,
    disabled: 0,
  };

  for (const row of rows) {
    /*
     * An endpoint switched off after its rows were queued.
     *
     * Retired rather than left `pending`, which would leave them due for ever
     * and re-examined by every tick from now until the table is pruned. The
     * seller's log says why.
     */
    if (!row.isActive) {
      await retire(row.id, "the endpoint was switched off before this was sent");
      run.abandoned += 1;
      continue;
    }

    const claimed = await claim(row.id, now);
    if (!claimed) continue; // Another tick got there first.

    run.attempted += 1;
    const outcome = await attempt(row, claimed.attempt, now);

    if (outcome.delivered) {
      run.delivered += 1;
      continue;
    }

    run.failed += 1;
    if (outcome.abandoned) run.abandoned += 1;
    if (outcome.disabled) run.disabled += 1;

    /*
     * One failure ends this endpoint's turn. The rest of its batch stays
     * `pending` and due, so the next tick tries again — which is the same
     * outcome as posting nine more times into a host that is plainly down,
     * minus nine timeouts holding the tick open.
     */
    break;
  }

  return run;
}

/* -------------------------------------------------------------------------- */
/*  One delivery                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Takes a row out of circulation and counts the attempt, atomically.
 *
 * The `lte` on `nextAttemptAt` is what makes this a mutual exclusion rather
 * than a read-then-write: the winner pushes the column into the future, so the
 * loser's WHERE no longer matches even though both saw the same row a moment
 * earlier.
 */
async function claim(id: string, now: Date): Promise<{ attempt: number } | null> {
  const claimed = maybeRow(
    await getDb()
      .update(webhookDeliveries)
      .set({
        attempt: sql`${webhookDeliveries.attempt} + 1`,
        nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS),
      })
      .where(
        and(
          eq(webhookDeliveries.id, id),
          eq(webhookDeliveries.status, "pending"),
          lte(webhookDeliveries.nextAttemptAt, now),
        ),
      )
      .returning({ attempt: webhookDeliveries.attempt }),
  );

  return claimed ?? null;
}

/** Gives up on a delivery without having posted it. */
async function retire(id: string, reason: string): Promise<void> {
  await getDb()
    .update(webhookDeliveries)
    .set({ status: "failed", error: reason })
    .where(eq(webhookDeliveries.id, id));
}

async function attempt(
  row: EndpointRow,
  attemptNumber: number,
  now: Date,
): Promise<{ delivered: boolean; abandoned: boolean; disabled: boolean }> {
  const db = getDb();

  /*
   * The body is serialised once and both signed and sent as *that string*.
   *
   * Signing a re-serialisation of the same object is the classic way to ship a
   * signature nobody can verify: `JSON.stringify` is deterministic for a given
   * object in a given runtime, but "the bytes we signed" and "the bytes we
   * sent" being separate expressions is a correctness property held by
   * coincidence rather than by construction.
   */
  const body = JSON.stringify(row.payload);
  const headers = signWebhook({
    id: row.id,
    body,
    secret: row.secret,
    now,
  });

  if (!headers) {
    /*
     * An unusable secret cannot be fixed by retrying. Rotating it is the
     * seller's move, and the log has to say so or they will watch a delivery
     * retry five times and conclude their own server is at fault.
     */
    await retire(row.id, "this endpoint's signing secret is unusable — rotate it");
    return { delivered: false, abandoned: true, disabled: false };
  }

  const result = await postWebhook({
    url: row.url,
    body,
    headers: { ...headers, "sailo-event": row.event },
  });

  if (result.ok) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "ok",
        deliveredAt: now,
        responseStatus: result.status,
        error: null,
      })
      .where(eq(webhookDeliveries.id, row.id));

    await db
      .update(webhookEndpoints)
      .set({
        // Consecutive, so any success clears the count entirely.
        failureCount: 0,
        lastAttemptAt: now,
        lastStatus: "ok",
        lastResponseStatus: result.status,
        updatedAt: now,
      })
      .where(eq(webhookEndpoints.id, row.endpointId));

    return { delivered: true, abandoned: false, disabled: false };
  }

  /* ---- It failed ---------------------------------------------------------- */

  const exhausted = attemptNumber >= MAX_ATTEMPTS;
  const backoff = RETRY_BACKOFF_MS[attemptNumber - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ?? 0;

  await db
    .update(webhookDeliveries)
    .set({
      status: exhausted ? "failed" : "pending",
      responseStatus: result.status,
      error: result.reason.slice(0, 300),
      /*
       * Left where the lease put it when the delivery is abandoned. Moving it
       * would be writing a date meaning "next attempt" onto a row that will
       * never have one.
       */
      ...(exhausted ? {} : { nextAttemptAt: new Date(now.getTime() + backoff) }),
    })
    .where(eq(webhookDeliveries.id, row.id));

  const endpoint = maybeRow(
    await db
      .update(webhookEndpoints)
      .set({
        failureCount: sql`${webhookEndpoints.failureCount} + 1`,
        lastAttemptAt: now,
        lastStatus: "failed",
        lastResponseStatus: result.status,
        updatedAt: now,
      })
      .where(eq(webhookEndpoints.id, row.endpointId))
      .returning({
        failureCount: webhookEndpoints.failureCount,
        url: webhookEndpoints.url,
        label: webhookEndpoints.label,
        shopId: webhookEndpoints.shopId,
      }),
  );

  let disabled = false;
  if (endpoint && endpoint.failureCount >= AUTO_DISABLE_AFTER) {
    disabled = await disableEndpoint({
      endpointId: row.endpointId,
      shopId: endpoint.shopId,
      url: endpoint.url,
      label: endpoint.label,
      reason: result.reason,
      now,
    });
  }

  return { delivered: false, abandoned: exhausted, disabled };
}

/* -------------------------------------------------------------------------- */
/*  Giving up on an endpoint                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Switches an endpoint off and tells the seller why.
 *
 * The UPDATE is conditional on it still being active, so the several failures
 * that can land in one tick disable it once and send one email rather than one
 * of each per failure.
 */
async function disableEndpoint(opts: {
  endpointId: string;
  shopId: string;
  url: string;
  label: string | null;
  reason: string;
  now: Date;
}): Promise<boolean> {
  const db = getDb();

  const stopped = maybeRow(
    await db
      .update(webhookEndpoints)
      .set({
        isActive: false,
        disabledReason: opts.reason.slice(0, 300),
        updatedAt: opts.now,
      })
      .where(
        and(
          eq(webhookEndpoints.id, opts.endpointId),
          eq(webhookEndpoints.isActive, true),
        ),
      )
      .returning({ id: webhookEndpoints.id }),
  );

  if (!stopped) return false;

  console.warn(
    `[sailo] webhook endpoint ${opts.endpointId} disabled after ` +
      `${AUTO_DISABLE_AFTER} consecutive failures: ${opts.reason}`,
  );

  /*
   * Best effort, and deliberately not awaited into anything that could fail
   * the tick. An endpoint that is off with no email is recoverable — the
   * settings card says so in red — and a mail provider having a bad afternoon
   * must not stop the queue draining for every other shop.
   */
  try {
    const shop = await db.query.shops.findFirst({
      where: eq(shops.id, opts.shopId),
    });
    if (!shop) return true;

    const to =
      shop.contactEmail ??
      (
        await db.query.user.findFirst({
          where: eq(user.id, shop.userId),
          columns: { email: true },
        })
      )?.email ??
      null;
    if (!to) return true;

    const sent = await sendSellerWebhookDisabled({
      shop,
      to,
      url: opts.url,
      label: opts.label,
      reason: opts.reason,
      failures: AUTO_DISABLE_AFTER,
    });
    if (!sent.sent) {
      console.warn(`[sailo] webhook-disabled email not sent: ${sent.reason}`);
    }
  } catch (error) {
    console.error("[sailo] webhook-disabled email failed", error);
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/*  Pruning                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Drops delivery rows older than thirty days.
 *
 * Called from the hourly sweep rather than given a cron of its own. This is
 * the one table in the schema whose row count grows with a shop's *traffic*
 * multiplied by its endpoints, and nothing reads a delivery older than the
 * log's own window.
 */
export async function pruneWebhookDeliveries(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 3_600_000);
  const deleted = await getDb()
    .delete(webhookDeliveries)
    .where(lte(webhookDeliveries.createdAt, cutoff))
    .returning({ id: webhookDeliveries.id });
  return deleted.length;
}

/* -------------------------------------------------------------------------- */

/** `Promise.all` with a ceiling, so a busy tick does not open 200 sockets. */
async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}
