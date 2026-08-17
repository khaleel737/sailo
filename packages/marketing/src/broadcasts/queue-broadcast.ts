/**
 * Putting a broadcast into the queue.
 *
 * The half of sending that answers to a seller pressing a button: check the plan, resolve
 * the audience, write one delivery row per recipient, and clamp to what the budget allows.
 * The other half — `./queue-run` — answers to a cron and has nobody to report to.
 */

import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { broadcastDeliveries, broadcasts, type Shop } from "@sailo/db/schema";
import { audienceFor } from "./audience";
import { parseSegment } from "./segments";
import { unsubscribeToken } from "./unsubscribe";
import { finish } from "./finish";

/**
 * Getting a broadcast out, one batch at a time, without ever sending twice.
 *
 * The whole design is one question: what happens when this crashes halfway.
 * The answer is that the *queue* is the state. Every recipient becomes a row
 * before anything is sent, and a row is claimed out of `queued` by a
 * conditional UPDATE that only one caller can win. A crash leaves the
 * unclaimed rows exactly as they were, so the next tick resumes from them —
 * and leaves the claimed ones claimed, so nobody is mailed a second time.
 *
 * A row can therefore end up stranded in `sending`: claimed by a process that
 * died before it heard back from Resend. Those are deliberately *not* swept
 * back to `queued`. We do not know whether that email went out, and the two
 * possible mistakes are not equal — a person who was not mailed will hear
 * from the next broadcast, and a person mailed twice presses "report spam",
 * which damages deliverability for every other seller on the domain. They are
 * counted and shown, not guessed at.
 */

export type QueueResult =
  | { ok: false; error: string }
  | { ok: true; queued: number; clamped: boolean };

/**
 * Writes the recipient list and marks the broadcast as sending.
 *
 * Claimed with a conditional UPDATE on `status = 'draft'`, so a seller
 * double-clicking Send builds the queue once. The rows are written *before*
 * the status flips to `sending`… no: the status is claimed first, precisely
 * because the claim is what makes the caller the only writer of those rows.
 * A second caller finds the broadcast already `sending` and stops.
 */
export async function queueBroadcast(opts: {
  shop: Shop;
  broadcastId: string;
  /**
   * The status this claim is allowed to take the broadcast out of.
   *
   * `draft` is a seller pressing Send; `scheduled` is the cron finding one
   * due. They are separate values rather than "whatever it currently is"
   * because the claim is the concurrency control: a scheduled broadcast that
   * a seller opens and sends by hand must be claimable exactly once between
   * the two paths, and a status this call did not expect means somebody else
   * got there first.
   */
  from?: "draft" | "scheduled";
}): Promise<QueueResult> {
  const db = getDb();
  const from = opts.from ?? "draft";

  /*
   * The link has to work before a single message goes out. Without a signing
   * secret every unsubscribe link in this send would be dead, and mail with
   * a dead unsubscribe link is not mail we may send at all.
   */
  if (!unsubscribeToken({ shopId: opts.shop.id, email: "probe@example.com" })) {
    return {
      ok: false,
      error: "Email isn't configured on this deployment (no signing secret).",
    };
  }

  /*
   * Claimed into `queuing`, not straight into `sending`.
   *
   * The queue cron selects `status = 'sending'` and, finding no `queued`
   * delivery rows, closes the broadcast. If the claim flipped to `sending`
   * before the delivery rows below existed, a tick landing in that window
   * would mark a broadcast `sent` with zero delivered and strand its rows
   * forever. `queuing` is a status the cron never selects, so the rows are
   * fully written before the broadcast becomes visible to it. The flip to
   * `sending` is the last thing this function does.
   */
  const [claimed] = await db
    .update(broadcasts)
    .set({ status: "queuing", startedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(broadcasts.id, opts.broadcastId),
        eq(broadcasts.shopId, opts.shop.id),
        // The claim. A second press finds nothing to claim and stops here.
        eq(broadcasts.status, from),
      ),
    )
    .returning();
  if (!claimed) {
    return { ok: false, error: "That broadcast has already been sent." };
  }

  /*
   * The audience is resolved *now*, at queue time, and not when the draft was
   * written. A broadcast scheduled on Monday for Friday reaches Thursday's
   * new subscriber and skips Wednesday's unsubscribe, because the segment is
   * a question and this is the moment it gets asked.
   */
  const { recipients, clamped } = await audienceFor(
    opts.shop.id,
    parseSegment(claimed.audienceFilter, claimed.audienceTag),
  );

  if (recipients.length > 0) {
    /*
     * `onConflictDoNothing` against the unique (broadcast, email) index, so
     * two clients sharing an address produce one delivery rather than a
     * duplicate-key error that would strand the broadcast in `sending`.
     */
    await db
      .insert(broadcastDeliveries)
      .values(
        recipients.map((r) => ({
          broadcastId: claimed.id,
          shopId: opts.shop.id,
          clientId: r.clientId,
          email: r.email,
        })),
      )
      .onConflictDoNothing();
  }

  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(broadcastDeliveries)
    .where(eq(broadcastDeliveries.broadcastId, claimed.id));
  const queued = Number(row?.n ?? 0);

  await db
    .update(broadcasts)
    .set({ recipientCount: queued, updatedAt: new Date() })
    .where(eq(broadcasts.id, claimed.id));

  if (queued === 0) {
    // Nobody to write to is a finished broadcast, not a stuck one.
    await finish(claimed.id, "queuing");
  } else {
    // Rows are all written; now make the broadcast visible to the queue cron.
    await db
      .update(broadcasts)
      .set({ status: "sending", updatedAt: new Date() })
      .where(and(eq(broadcasts.id, claimed.id), eq(broadcasts.status, "queuing")));
  }

  return { ok: true, queued, clamped };
}
