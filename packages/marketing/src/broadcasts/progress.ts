/**
 * How a broadcast is doing, for the list and the detail screen.
 */

import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { broadcastDeliveries } from "@sailo/db/schema";

/** How a broadcast is doing, for the list and the detail screen. */
export async function broadcastProgress(broadcastId: string) {
  const rows = await getDb()
    .select({
      status: broadcastDeliveries.status,
      n: sql<string>`count(*)`,
    })
    .from(broadcastDeliveries)
    .where(eq(broadcastDeliveries.broadcastId, broadcastId))
    .groupBy(broadcastDeliveries.status);

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = Number(row.n);

  return {
    queued: counts.queued ?? 0,
    sending: counts.sending ?? 0,
    sent: counts.sent ?? 0,
    failed: counts.failed ?? 0,
    suppressed: counts.suppressed ?? 0,
  };
}
