/**
 * Keeping the delivery log from growing without bound.
 */

import "server-only";
import { lte } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { webhookDeliveries } from "@sailo/db/schema";

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
