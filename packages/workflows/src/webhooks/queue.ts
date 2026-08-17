/**
 * One tick of the delivery queue, and the four decisions that shape it.
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

import "server-only";
import { and, asc, eq, lte } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { webhookDeliveries, webhookEndpoints } from "@sailo/db/schema";
import { attempt } from "./attempt";
import { claim, retire } from "./claim";
import {
  MAX_CONCURRENT_ENDPOINTS,
  MAX_PER_ENDPOINT,
  MAX_PER_TICK,
  type QueueRun,
} from "./policy";
import type { EndpointRow } from "./rows";

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

/** Every due delivery for one endpoint, in sequence, stopping at the first failure. */
export async function drainEndpoint(rows: EndpointRow[], now: Date): Promise<QueueRun> {
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
