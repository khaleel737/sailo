import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  broadcastDeliveries,
  broadcasts,
  shops,
  type Broadcast,
  type Shop,
} from "@/db/schema";
import { ORDERS, MAX_BATCH, sendBatch, sender } from "@/lib/email/transport";
import { getDictionary } from "@/i18n";
import { audienceFor } from "./audience";
import { budgetFor } from "./quota";
import { renderBroadcast, renderText } from "./render";
import { unsubscribeToken, unsubscribePostUrl, unsubscribeUrl } from "./unsubscribe";

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
}): Promise<QueueResult> {
  const db = getDb();

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
        eq(broadcasts.status, "draft"),
      ),
    )
    .returning();
  if (!claimed) {
    return { ok: false, error: "That broadcast has already been sent." };
  }

  const { recipients, clamped } = await audienceFor(
    opts.shop.id,
    claimed.audienceTag,
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

/**
 * How many broadcasts one tick will actually send a batch for, and how many it
 * will look at to find them.
 *
 * Two numbers, not one, and that is the whole point. A broadcast held by a
 * quota stays `sending` until the window rolls — which is correct — but if a
 * held broadcast counted against the work limit, enough of them would fill
 * every slot and no shop would ever get a batch again. The one that starves is
 * always somebody else's, so it would never be reported. Held broadcasts are
 * therefore skipped over rather than counted, and the candidate window is wide
 * enough to reach past them.
 */
const WORK_PER_TICK = 20;
const CANDIDATES_PER_TICK = 200;

/** One tick of the queue: at most one batch per broadcast in flight. */
export async function runBroadcastQueue(now = new Date()) {
  const db = getDb();

  const inFlight = await db.query.broadcasts.findMany({
    where: eq(broadcasts.status, "sending"),
    // Oldest first, so a broadcast cannot be overtaken forever by newer ones.
    orderBy: broadcasts.startedAt,
    limit: CANDIDATES_PER_TICK,
  });

  let sent = 0;
  let failed = 0;
  let suppressed = 0;
  let held = 0;
  let worked = 0;

  for (const broadcast of inFlight) {
    if (worked >= WORK_PER_TICK) break;

    const shop = await db.query.shops.findFirst({
      where: eq(shops.id, broadcast.shopId),
    });
    if (!shop) continue;

    const budget = await budgetFor(shop, now);
    if (budget.available === 0) {
      held += 1;
      /*
       * Left `sending` with its rows still `queued`, on purpose. The next
       * tick after the window rolls picks up exactly where this stopped, and
       * the seller's screen shows "412 of 900" rather than a broadcast that
       * claims to be finished.
       */
      console.warn(
        `[sailo] broadcast ${broadcast.id} paused: ${budget.limitedBy} daily limit reached`,
      );
      continue;
    }

    worked += 1;
    const result = await sendOneBatch({
      shop,
      broadcast,
      limit: Math.min(MAX_BATCH, budget.available),
    });
    sent += result.sent;
    failed += result.failed;
    suppressed += result.suppressed;
  }

  return { sent, failed, suppressed, held, broadcasts: inFlight.length };
}

async function sendOneBatch(opts: {
  shop: Shop;
  broadcast: Broadcast;
  limit: number;
}) {
  const db = getDb();
  const { shop, broadcast } = opts;

  /*
   * The same refusal `queueBroadcast` makes, made again here.
   *
   * The enqueue path checks for a signing secret before it will queue a
   * broadcast — but a secret present at queue time can be absent by the tick
   * that sends, if the cron runs in an environment missing it or the key was
   * rotated away. Without this the batch would ship with `unsubscribeUrl("")`,
   * a footer and a `List-Unsubscribe` header both pointing at a dead
   * `/u/` and `/api/unsubscribe/` — mail carrying a broken unsubscribe link,
   * which is exactly the mail this feature promises never to send. Leaving the
   * rows `queued` lets a later tick, in a fixed environment, send them for
   * real.
   */
  if (!unsubscribeToken({ shopId: shop.id, email: "probe@example.com" })) {
    console.error(
      `[sailo] broadcast ${broadcast.id} not sent: no unsubscribe signing secret`,
    );
    return { sent: 0, failed: 0, suppressed: 0 };
  }

  /*
   * The claim, and the only thing standing between a retry and a duplicate.
   *
   * `FOR UPDATE SKIP LOCKED` inside the subquery is what lets two ticks run
   * at once without both claiming the same rows: the second one skips what
   * the first has locked instead of blocking behind it. The UPDATE's own
   * `status = 'queued'` is the belt to that brace — a row claimed between the
   * subquery and the write is not claimed twice.
   */
  const claimed = await db
    .update(broadcastDeliveries)
    .set({ status: "sending", attempts: sql`${broadcastDeliveries.attempts} + 1` })
    .where(
      and(
        eq(broadcastDeliveries.status, "queued"),
        inArray(
          broadcastDeliveries.id,
          sql`(select id from ${broadcastDeliveries}
               where broadcast_id = ${broadcast.id} and status = 'queued'
               order by created_at
               limit ${opts.limit}
               for update skip locked)`,
        ),
      ),
    )
    .returning();

  if (claimed.length === 0) {
    // Nothing left to claim: either finished, or every remaining row is
    // stranded in `sending` and will not be retried. Both end the broadcast.
    await finish(broadcast.id);
    return { sent: 0, failed: 0, suppressed: 0 };
  }

  /*
   * Suppression is re-checked here and not only when the queue was built.
   * A broadcast to nine hundred people takes several ticks, and somebody who
   * unsubscribes from batch one must not be in batch four — which is exactly
   * the moment a working unsubscribe stops being a link and becomes a promise.
   */
  const suppressedNow = new Set(
    (
      await db.query.emailSuppressions.findMany({
        where: (t, { and: a, eq: e, inArray: i }) =>
          a(
            e(t.shopId, shop.id),
            i(t.email, claimed.map((c) => c.email)),
          ),
        columns: { email: true },
      })
    ).map((r) => r.email),
  );

  const toSend = claimed.filter((row) => !suppressedNow.has(row.email));
  const skipped = claimed.filter((row) => suppressedNow.has(row.email));

  if (skipped.length > 0) {
    await db
      .update(broadcastDeliveries)
      .set({ status: "suppressed" })
      .where(
        inArray(
          broadcastDeliveries.id,
          skipped.map((r) => r.id),
        ),
      );
  }

  const { t } = shopDictionary(shop);
  const from = sender(shop.name, ORDERS);
  const senderLine = shop.location
    ? `${shop.name} · ${shop.location}`
    : shop.name;

  const messages = toSend.map((row) => {
    const token = unsubscribeToken({ shopId: shop.id, email: row.email });
    const url = unsubscribeUrl(token ?? "");
    const oneClick = unsubscribePostUrl(token ?? "");
    return {
      from,
      to: row.email,
      subject: broadcast.subject,
      html: renderBroadcast({
        shop,
        subject: broadcast.subject,
        bodyMarkdown: broadcast.bodyMarkdown,
        unsubscribeUrl: url,
        senderLine,
        unsubscribeLabel: t.unsubscribe.link,
      }),
      text: renderText(broadcast.bodyMarkdown, url),
      replyTo: shop.contactEmail ?? undefined,
      headers: {
        /*
         * RFC 8058. The pair is what puts a one-click unsubscribe in Gmail's
         * own chrome, and Gmail requires it on bulk mail — a sender without
         * it is a sender whose mail goes to spam, which is a worse outcome
         * for the seller than not sending at all.
         */
        "List-Unsubscribe": `<${oneClick}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  });

  const results = await sendBatch(messages);

  let sentCount = 0;
  let failedCount = 0;

  for (const [i, row] of toSend.entries()) {
    const result = results[i];
    if (result?.sent) {
      sentCount += 1;
      await db
        .update(broadcastDeliveries)
        .set({ status: "sent", providerId: result.id, sentAt: new Date(), error: null })
        .where(eq(broadcastDeliveries.id, row.id));
    } else {
      failedCount += 1;
      await db
        .update(broadcastDeliveries)
        .set({
          status: "failed",
          error: (result?.reason ?? "unknown").slice(0, 500),
        })
        .where(eq(broadcastDeliveries.id, row.id));
    }
  }

  return { sent: sentCount, failed: failedCount, suppressed: skipped.length };
}

/**
 * Marks a broadcast finished once nothing is left queued.
 *
 * `from` is the status this close is allowed to happen out of — `sending` for
 * a queue tick that drained the last batch, `queuing` for the send action
 * closing a broadcast that had no recipients at all. Guarding on it keeps two
 * ticks from both closing the same broadcast.
 */
async function finish(broadcastId: string, from: "sending" | "queuing" = "sending") {
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

/** The shop's own language, for the one line of chrome we own. */
function shopDictionary(shop: Shop) {
  return { t: getDictionary(shop.locale ?? "en") };
}

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
