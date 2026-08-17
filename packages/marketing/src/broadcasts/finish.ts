/**
 * Marking a broadcast done.
 *
 * Its own module because both halves of the queue call it — the seller-facing path when
 * there turns out to be nobody to send to, and the tick when the last batch lands — and a
 * shared function inside either one of them would make the two import each other.
 */

import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { broadcastDeliveries, broadcasts } from "@sailo/db/schema";

/**
 * Marks a broadcast finished once nothing is left queued.
 *
 * `from` is the status this close is allowed to happen out of — `sending` for
 * a queue tick that drained the last batch, `queuing` for the send action
 * closing a broadcast that had no recipients at all. Guarding on it keeps two
 * ticks from both closing the same broadcast.
 */
export async function finish(broadcastId: string, from: "sending" | "queuing" = "sending") {
  const db = getDb();

  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(broadcastDeliveries)
    .where(
      and(
        eq(broadcastDeliveries.broadcastId, broadcastId),
        eq(broadcastDeliveries.status, "queued"),
      ),
    );
  // Anything still queued means another tick has work to do; only the tick
  // that empties the queue is the one that closes the broadcast.
  if (Number(row?.n ?? 0) > 0) return;

  await db
    .update(broadcasts)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(broadcasts.id, broadcastId), eq(broadcasts.status, from)),
    );
}
