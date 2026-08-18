import "server-only";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  marketingOptOuts,
  newsletterDeliveries,
  newsletters,
  type Newsletter,
} from "@sailo/db/schema";
import { MAX_BATCH, MARKETING, sendBatch } from "@sailo/mailer/transport";
import { marketingOptOutToken, marketingOptOutUrl } from "../lifecycle/unsubscribe";
import { newsletterHeaders } from "./messages";
import { renderNewsletter, renderNewsletterText } from "./render";
import { newsletterAudience } from "./audience";
import { isNewsletterAudience, DEFAULT_NEWSLETTER_AUDIENCE } from "./list";

/**
 * Sending a campaign to Sailo's own list.
 *
 * The same three-phase shape the broadcast queue uses, because it is the shape
 * that survives being run twice: **claim, send, record**, where the claim is a
 * row transition arbitrated by Postgres rather than by the loop. Two ticks
 * racing, a retry after a timeout, a hand-run against production while
 * debugging — each pair claims a row between them and sends one email.
 *
 * One batch per tick per campaign, deliberately. A list of forty thousand does
 * not go out in one request whatever the provider says it will accept: a
 * partial failure halfway through is unrecoverable if the whole list was one
 * call, and a queue that drains over an hour is also a queue that can be
 * stopped when somebody spots a typo in the second paragraph.
 */

/** How many campaigns one tick will work on. */
const WORK_PER_TICK = 5;

/**
 * The platform's daily budget for its own newsletter.
 *
 * Configurable because the right number is whatever the Resend plan allows,
 * and that changes without a deploy. Deliberately shared in spirit with
 * `LIFECYCLE_DAILY_CEILING` but counted separately: the two streams have
 * different failure modes, and one campaign eating the onboarding pipeline's
 * budget would silently stall every new seller's first three emails.
 */
function dailyCeiling(): number {
  const raw = Number(process.env.NEWSLETTER_DAILY_CEILING);
  return Number.isFinite(raw) && raw > 0 ? raw : 20_000;
}

/** How many campaign emails have actually left in the last 24 hours. */
export async function newsletterSentToday(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [row] = await getDb()
    .select({ n: sql<string>`count(*)` })
    .from(newsletterDeliveries)
    .where(
      and(
        sql`${newsletterDeliveries.sentAt} is not null`,
        sql`${newsletterDeliveries.sentAt} >= ${since}`,
      ),
    );
  return Number(row?.n ?? 0);
}

/* --------------------------------------------------------------------------
   Queuing
-------------------------------------------------------------------------- */

export type QueueResult =
  | { ok: true; queued: number; clamped: boolean }
  | { ok: false; reason: string };

/**
 * Turns a draft into a queue: one delivery row per address, then `sending`.
 *
 * The rows are written *before* anything leaves, which is what makes a crash
 * mid-send survivable — the next tick finds `queued` rows and continues,
 * rather than rebuilding a list that would come out slightly different and
 * mailing the overlap twice.
 *
 * The status transition is the claim. `where status in (draft, scheduled)` is
 * what makes two presses of Send, or a press racing the scheduler, produce one
 * queue between them: the second update matches nothing and stops here.
 */
export async function queueNewsletter(opts: {
  newsletterId: string;
  /** `manual` when a person pressed Send, `scheduled` when the cron promoted it. */
  from: "manual" | "scheduled";
}): Promise<QueueResult> {
  const db = getDb();

  /*
   * The unsubscribe link has to work before a single row is written.
   *
   * Without a signing secret every link in this campaign would be dead — a
   * footer and a `List-Unsubscribe` header both pointing at a route that
   * refuses every token — and mail carrying a broken unsubscribe link is not
   * mail we may send at all. Refusing here leaves the campaign a draft, so a
   * later attempt in a fixed environment sends it for real.
   */
  if (!marketingOptOutToken({ email: "probe@example.com" })) {
    return { ok: false, reason: "no unsubscribe signing secret" };
  }

  const claimed = await db
    .update(newsletters)
    .set({ status: "queuing", startedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(newsletters.id, opts.newsletterId),
        inArray(newsletters.status, [
          opts.from === "manual" ? "draft" : "scheduled",
          // A `queuing` row is one a previous attempt abandoned mid-build.
          // Re-entering it is safe because the delivery insert below is
          // idempotent on (campaign, address).
          "queuing",
        ]),
      ),
    )
    .returning();

  const campaign = claimed[0];
  if (!campaign) return { ok: false, reason: "not a draft" };

  const audience = isNewsletterAudience(campaign.audience)
    ? campaign.audience
    : DEFAULT_NEWSLETTER_AUDIENCE;

  const { recipients, clamped } = await newsletterAudience(audience);

  if (recipients.length === 0) {
    /*
     * An empty audience is finished, not stuck. Marking it `sent` with a
     * recipient count of zero is the honest record — a campaign left
     * `queuing` forever would be retried on every tick until somebody
     * noticed, and the screen would show it as in-flight when nothing is.
     */
    await db
      .update(newsletters)
      .set({
        status: "sent",
        recipientCount: 0,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(newsletters.id, campaign.id));
    return { ok: true, queued: 0, clamped };
  }

  /*
   * Inserted in chunks because a single statement with forty thousand VALUES
   * rows is a statement some drivers refuse and every one of them buffers
   * entirely in memory first.
   *
   * `onConflictDoNothing` against the unique (campaign, address) index is what
   * makes a re-entered queue safe: rows written by the abandoned attempt stay,
   * and nothing is duplicated.
   */
  const CHUNK = 1_000;
  for (let i = 0; i < recipients.length; i += CHUNK) {
    await db
      .insert(newsletterDeliveries)
      .values(
        recipients.slice(i, i + CHUNK).map((r) => ({
          newsletterId: campaign.id,
          subscriberId: r.subscriberId,
          email: r.email,
        })),
      )
      .onConflictDoNothing();
  }

  await db
    .update(newsletters)
    .set({
      status: "sending",
      recipientCount: recipients.length,
      updatedAt: new Date(),
    })
    .where(eq(newsletters.id, campaign.id));

  return { ok: true, queued: recipients.length, clamped };
}

/* --------------------------------------------------------------------------
   The tick
-------------------------------------------------------------------------- */

export type NewsletterPassResult = {
  /** Campaigns whose schedule came due and became queues this tick. */
  started: number;
  sent: number;
  failed: number;
  /** Rows skipped because the address opted out after the queue was built. */
  suppressed: number;
  /** Campaigns in flight that a ceiling stopped this tick. */
  held: number;
  campaigns: number;
};

/** Scheduled campaigns that have come due, turned into queues. */
async function promoteScheduled(now: Date): Promise<number> {
  const due = await getDb().query.newsletters.findMany({
    where: and(
      eq(newsletters.status, "scheduled"),
      lte(newsletters.scheduledAt, now),
    ),
    orderBy: newsletters.scheduledAt,
    limit: WORK_PER_TICK,
  });

  let started = 0;
  for (const campaign of due) {
    const result = await queueNewsletter({
      newsletterId: campaign.id,
      from: "scheduled",
    });
    if (result.ok) started += 1;
    else {
      console.error(
        `[sailo] newsletter ${campaign.id} not queued: ${result.reason}`,
      );
    }
  }
  return started;
}

/** One tick: promote what is due, then one batch per campaign in flight. */
export async function runNewsletterQueue(
  now = new Date(),
): Promise<NewsletterPassResult> {
  const db = getDb();

  const started = await promoteScheduled(now);

  const budget = dailyCeiling() - (await newsletterSentToday(now));
  const inFlight = await db.query.newsletters.findMany({
    where: eq(newsletters.status, "sending"),
    // Oldest first, so a campaign cannot be overtaken forever by newer ones.
    orderBy: newsletters.startedAt,
    limit: WORK_PER_TICK,
  });

  const result: NewsletterPassResult = {
    started,
    sent: 0,
    failed: 0,
    suppressed: 0,
    held: 0,
    campaigns: inFlight.length,
  };

  if (budget <= 0) {
    /*
     * Held, not failed, and the rows stay `queued`. The next tick after the
     * window rolls picks up exactly where this stopped, and the campaign's
     * page goes on showing "412 of 900" rather than claiming to be finished.
     */
    console.warn("[sailo] newsletter queue held: daily ceiling reached");
    result.held = inFlight.length;
    return result;
  }

  let remaining = budget;
  for (const campaign of inFlight) {
    if (remaining <= 0) {
      result.held += 1;
      continue;
    }
    const batch = await sendOneBatch(campaign, Math.min(MAX_BATCH, remaining));
    result.sent += batch.sent;
    result.failed += batch.failed;
    result.suppressed += batch.suppressed;
    remaining -= batch.sent + batch.failed;
  }

  return result;
}

async function sendOneBatch(campaign: Newsletter, limit: number) {
  const db = getDb();
  const none = { sent: 0, failed: 0, suppressed: 0 };

  /*
   * The same refusal `queueNewsletter` makes, made again here.
   *
   * A secret present when the campaign was queued can be absent by the tick
   * that sends it — a cron running in an environment missing it, or a key
   * rotated away. Without this the batch would ship with a footer and a
   * `List-Unsubscribe` header both pointing at a dead route. Leaving the rows
   * `queued` lets a later tick send them for real.
   */
  if (!marketingOptOutToken({ email: "probe@example.com" })) {
    console.error(
      `[sailo] newsletter ${campaign.id} not sent: no unsubscribe signing secret`,
    );
    return none;
  }

  /*
   * The claim, and the only thing standing between a retry and a duplicate.
   *
   * `FOR UPDATE SKIP LOCKED` inside the subquery lets two ticks run at once
   * without both claiming the same rows: the second skips what the first has
   * locked instead of blocking behind it. The UPDATE's own `status = 'queued'`
   * is the belt to that brace.
   */
  const claimed = await db
    .update(newsletterDeliveries)
    .set({
      status: "sending",
      attempts: sql`${newsletterDeliveries.attempts} + 1`,
    })
    .where(
      and(
        eq(newsletterDeliveries.status, "queued"),
        inArray(
          newsletterDeliveries.id,
          sql`(select id from ${newsletterDeliveries}
               where newsletter_id = ${campaign.id} and status = 'queued'
               order by created_at
               limit ${limit}
               for update skip locked)`,
        ),
      ),
    )
    .returning();

  if (claimed.length === 0) {
    // Nothing left to claim: either finished, or every remaining row is
    // stranded in `sending` and will not be retried. Both end the campaign.
    await finishNewsletter(campaign.id);
    return none;
  }

  /*
   * Opt-outs are re-checked here and not only when the queue was built.
   *
   * A campaign to forty thousand people takes many ticks, and somebody who
   * unsubscribes from the first batch must not be in the fortieth — which is
   * exactly the moment a working unsubscribe stops being a link and becomes a
   * promise.
   */
  const gone = new Set(
    (
      await db
        .select({ email: marketingOptOuts.email })
        .from(marketingOptOuts)
        .where(
          inArray(
            marketingOptOuts.email,
            claimed.map((row) => row.email),
          ),
        )
    ).map((row) => row.email),
  );

  const skipped = claimed.filter((row) => gone.has(row.email));
  const toSend = claimed.filter((row) => !gone.has(row.email));

  if (skipped.length > 0) {
    await db
      .update(newsletterDeliveries)
      .set({ status: "suppressed" })
      .where(
        inArray(
          newsletterDeliveries.id,
          skipped.map((row) => row.id),
        ),
      );
  }

  if (toSend.length === 0) {
    return { sent: 0, failed: 0, suppressed: skipped.length };
  }

  const content = {
    subject: campaign.subject,
    previewText: campaign.previewText,
    bodyMarkdown: campaign.bodyMarkdown,
    ctaLabel: campaign.ctaLabel,
    ctaUrl: campaign.ctaUrl,
  };

  const messages = toSend.map((row) => {
    /*
     * A token per recipient, because the link has to unsubscribe *them*. One
     * token for the batch would put the first recipient's address in every
     * copy — an unsubscribe link that removes somebody else is worse than none
     * at all, and it is a data leak besides.
     */
    const token = marketingOptOutToken({ email: row.email }) ?? "";
    const url = marketingOptOutUrl(token);
    return {
      from: `Sailo <${MARKETING}>`,
      to: row.email,
      subject: campaign.subject,
      html: renderNewsletter({ content, unsubscribeUrl: url }),
      text: renderNewsletterText({
        content,
        unsubscribeUrl: url,
        unsubscribeLabel: "Unsubscribe",
      }),
      headers: newsletterHeaders(token),
    };
  });

  const results = await sendBatch(messages);
  const now = new Date();

  let sent = 0;
  let failed = 0;

  /*
   * One update per row rather than two grouped statements.
   *
   * The provider returns a distinct id per message and that id is the only
   * thing a later bounce webhook can use to find this row again — grouping the
   * successes into one `IN (...)` would mean throwing every id away to save a
   * hundred writes on a path that runs once every five minutes.
   */
  await Promise.all(
    results.map((result, i) => {
      const row = toSend[i];
      if (!row) return Promise.resolve();
      if (result.sent) {
        sent += 1;
        return db
          .update(newsletterDeliveries)
          .set({ status: "sent", providerId: result.id, sentAt: now })
          .where(eq(newsletterDeliveries.id, row.id));
      }
      failed += 1;
      return db
        .update(newsletterDeliveries)
        .set({ status: "failed", error: result.reason })
        .where(eq(newsletterDeliveries.id, row.id));
    }),
  );

  return { sent, failed, suppressed: skipped.length };
}

/**
 * Marks a campaign finished once nothing is left to claim.
 *
 * Guarded on `status = 'sending'` and on there being no queued rows, so two
 * ticks arriving at the end together write one completion between them and the
 * `sentAt` stamp is the first one rather than the last.
 */
export async function finishNewsletter(newsletterId: string): Promise<void> {
  const db = getDb();

  const [pending] = await db
    .select({ n: sql<string>`count(*)` })
    .from(newsletterDeliveries)
    .where(
      and(
        eq(newsletterDeliveries.newsletterId, newsletterId),
        eq(newsletterDeliveries.status, "queued"),
      ),
    );

  if (Number(pending?.n ?? 0) > 0) return;

  await db
    .update(newsletters)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(newsletters.id, newsletterId),
        eq(newsletters.status, "sending"),
        isNull(newsletters.sentAt),
      ),
    );
}

/* --------------------------------------------------------------------------
   How it is going
-------------------------------------------------------------------------- */

export type NewsletterProgress = {
  queued: number;
  sent: number;
  failed: number;
  suppressed: number;
  total: number;
};

/**
 * One statement, filtered counts, so the four numbers on a campaign's page
 * cannot disagree with each other — which is what four separate counts would
 * eventually do while a send is in flight underneath them.
 */
export async function newsletterProgress(
  newsletterId: string,
): Promise<NewsletterProgress> {
  const [row] = await getDb()
    .select({
      total: sql<string>`count(*)`,
      queued: sql<string>`count(*) filter (where ${newsletterDeliveries.status} in ('queued', 'sending'))`,
      sent: sql<string>`count(*) filter (where ${newsletterDeliveries.status} = 'sent')`,
      failed: sql<string>`count(*) filter (where ${newsletterDeliveries.status} = 'failed')`,
      suppressed: sql<string>`count(*) filter (where ${newsletterDeliveries.status} = 'suppressed')`,
    })
    .from(newsletterDeliveries)
    .where(eq(newsletterDeliveries.newsletterId, newsletterId));

  return {
    total: Number(row?.total ?? 0),
    queued: Number(row?.queued ?? 0),
    sent: Number(row?.sent ?? 0),
    failed: Number(row?.failed ?? 0),
    suppressed: Number(row?.suppressed ?? 0),
  };
}

/**
 * The delivery row a provider id belongs to — how a bounce finds its way home.
 *
 * The webhook receives only a message id and has to decide *whose* list an
 * address comes off: a shop's buyers, Sailo's sellers, or Sailo's readers.
 * Three tables can own an id and the row is the only thing that actually
 * knows; inferring it from the payload would be scoping a suppression from an
 * attacker-shaped body rather than from what we wrote when we sent.
 */
export async function newsletterDeliveryByProviderId(providerId: string) {
  return getDb().query.newsletterDeliveries.findFirst({
    where: eq(newsletterDeliveries.providerId, providerId),
  });
}

/** Marks a delivery failed after the fact, from a bounce or a complaint. */
export async function markNewsletterFailed(
  ids: string[],
  reason: string,
): Promise<void> {
  if (ids.length === 0) return;
  await getDb()
    .update(newsletterDeliveries)
    .set({ status: "failed", error: reason })
    .where(
      and(
        inArray(newsletterDeliveries.id, ids),
        // Only a delivery we believed had succeeded. A row already marked
        // failed keeps its original reason, which is the more specific one.
        eq(newsletterDeliveries.status, "sent"),
      ),
    );
}
