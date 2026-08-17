/**
 * One tick of the broadcast queue.
 *
 * At most one batch per broadcast in flight, so a shop with fifty thousand recipients
 * cannot starve every other shop's newsletter — and so a provider's rate limit is met by
 * one sender rather than by all of them at once.
 */

import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  broadcastDeliveries,
  broadcasts,
  shops,
  type Broadcast,
  type Shop,
} from "@sailo/db/schema";
import { ORDERS, MAX_BATCH, sendBatch, sender } from "@sailo/mailer/transport";
import { can } from "@sailo/core/plans";
import { applyMergeTags, mergeValuesFor } from "./markdown";
import { renderBroadcast, renderText } from "./render";
import { unsubscribeToken, unsubscribePostUrl, unsubscribeUrl } from "./unsubscribe";
import { broadcastLabels, shopDictionary } from "./labels";
import { namesFor } from "./recipients";
import { resolveContent } from "./content";
import { budgetFor } from "./quota";
import { queueBroadcast } from "./queue-broadcast";
import { finish } from "./finish";

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

/**
 * Scheduled sends that have come due, turned into queues.
 *
 * The promotion is `queueBroadcast` with a different claim status and
 * nothing else — the send path does not know or care that a broadcast was
 * scheduled, which is what keeps scheduling from being a second, subtly
 * different way to send.
 *
 * The plan is re-read here rather than trusted from when the schedule was
 * set. A seller who scheduled six weeks of campaigns and then downgraded has
 * not bought the right to keep sending them, and the check that gates the
 * button is worth nothing if the cron does not make it too.
 */
async function promoteScheduled(now: Date) {
  const db = getDb();

  const due = await db.query.broadcasts.findMany({
    where: and(eq(broadcasts.status, "scheduled"), lte(broadcasts.scheduledAt, now)),
    orderBy: broadcasts.scheduledAt,
    limit: WORK_PER_TICK,
  });

  let started = 0;
  let skipped = 0;

  for (const broadcast of due) {
    const shop = await db.query.shops.findFirst({
      where: eq(shops.id, broadcast.shopId),
    });
    if (!shop) continue;

    if (!can(shop, "broadcasts")) {
      /*
       * Back to a draft, not deleted and not left due forever. The seller's
       * words are still theirs, the schedule is what lapsed, and a row that
       * stays `scheduled` past its time would be retried on every tick for
       * as long as the shop exists.
       */
      await db
        .update(broadcasts)
        .set({ status: "draft", scheduledAt: null, updatedAt: new Date() })
        .where(and(eq(broadcasts.id, broadcast.id), eq(broadcasts.status, "scheduled")));
      console.warn(
        `[sailo] broadcast ${broadcast.id} unscheduled: shop no longer on a plan with broadcasts`,
      );
      skipped += 1;
      continue;
    }

    const result = await queueBroadcast({
      shop,
      broadcastId: broadcast.id,
      from: "scheduled",
    });
    if (result.ok) started += 1;
  }

  return { started, skipped };
}

/** One tick of the queue: at most one batch per broadcast in flight. */
export async function runBroadcastQueue(now = new Date()) {
  const db = getDb();

  // Due schedules become queues first, so a broadcast set for 09:00 starts
  // sending on the 09:00 tick rather than the one after it.
  const scheduled = await promoteScheduled(now);

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
       *
       * Which is true of three of the four ceilings. A shop paused for its
       * reputation is not waiting for a window to roll — it is waiting for a
       * person — so it is logged as the different thing it is, rather than as
       * a limit that will lift on its own tonight.
       */
      console.warn(
        budget.limitedBy === "paused"
          ? `[sailo] broadcast ${broadcast.id} held: shop ${shop.id} marketing is paused`
          : `[sailo] broadcast ${broadcast.id} paused: ${budget.limitedBy} daily limit reached`,
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

  return {
    sent,
    failed,
    suppressed,
    held,
    broadcasts: inFlight.length,
    started: scheduled.started,
    unscheduled: scheduled.skipped,
  };
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

  /*
   * The offer is resolved once for the batch, not once per recipient. A
   * hundred people get one coupon lookup and one product query between them,
   * and — more importantly — they get the *same* email: resolving per
   * recipient would let a coupon edited mid-send split one campaign into two
   * different promises.
   */
  const content = await resolveContent(shop, broadcast, t);
  const labels = broadcastLabels(t);

  /*
   * Names, for `{{first_name}}`, read from the client rows this batch points
   * at rather than snapshotted onto the delivery.
   *
   * A delivery row deliberately snapshots the *address* — who was mailed is a
   * fact — but a name is not part of that fact, and someone who corrects the
   * spelling of their own name between batch one and batch four should be
   * greeted correctly in batch four. One query for a hundred rows.
   */
  const names = await namesFor(toSend.map((row) => row.clientId));

  const messages = toSend.map((row) => {
    const token = unsubscribeToken({ shopId: shop.id, email: row.email });
    const url = unsubscribeUrl(token ?? "");
    const oneClick = unsubscribePostUrl(token ?? "");
    const merge = mergeValuesFor({
      name: row.clientId ? (names.get(row.clientId) ?? null) : null,
      shopName: shop.name,
      couponCode: content.coupon?.code,
      fallbackName: labels.friend,
    });
    return {
      from,
      to: row.email,
      subject: applyMergeTags(content.subject, merge, false),
      html: renderBroadcast({
        shop,
        content,
        unsubscribeUrl: url,
        senderLine,
        labels,
        merge,
      }),
      text: renderText({
        content,
        unsubscribeUrl: url,
        labels,
        merge,
        currency: shop.currency,
      }),
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
