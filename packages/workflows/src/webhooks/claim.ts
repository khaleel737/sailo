/**
 * Taking a row out of circulation, and giving up on one.
 *
 * Both are single conditional UPDATEs, and that is the whole point of having them
 * apart from the posting: the mutual exclusion lives here and the HTTP lives in
 * `./attempt`. A reader checking "can two ticks post the same delivery" should not have
 * to read a signing routine to find out.
 */

import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { webhookDeliveries } from "@sailo/db/schema";
import { maybeRow } from "@sailo/core/invariant";
import { CLAIM_LEASE_MS } from "./policy";

/**
 * Takes a row out of circulation and counts the attempt, atomically.
 *
 * The `lte` on `nextAttemptAt` is what makes this a mutual exclusion rather
 * than a read-then-write: the winner pushes the column into the future, so the
 * loser's WHERE no longer matches even though both saw the same row a moment
 * earlier.
 */
export async function claim(id: string, now: Date): Promise<{ attempt: number } | null> {
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
export async function retire(id: string, reason: string): Promise<void> {
  await getDb()
    .update(webhookDeliveries)
    .set({ status: "failed", error: reason })
    .where(eq(webhookDeliveries.id, id));
}
