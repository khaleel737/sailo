import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { lifecycleEmails } from "@sailo/db/schema";
import { lifecycleMessage } from "./messages";
import { MAX_BATCH, sendBatch } from "@sailo/email/transport";
import {
  RETIRED_STEP,
  isRetirable,
  nextLifecycleStep,
  type LifecycleStepId,
} from "./steps";
import { lifecycleCandidates, lifecycleSentTodayPlatform, type LifecycleState } from "./state";
import {
  marketingOptOutPostUrl,
  marketingOptOutToken,
  marketingOptOutUrl,
} from "./unsubscribe";

/**
 * One tick of the lifecycle pipeline.
 *
 * The shape is the same one the broadcast queue and the event reminders use,
 * because it is the shape that survives being run twice: **read, claim,
 * send, record**, with the claim being an INSERT whose unique index decides
 * the winner. Nothing in here reads a row in order to decide whether to write
 * one. Two ticks racing, a retry after a timeout, a hand-run against
 * production while debugging, two regions firing at the same minute — each
 * pair claims one row between them and sends one email.
 *
 * A failed send keeps its claim rather than releasing it, which is the
 * deliberate trade `event-reminders.ts` documents at length: "retried" and
 * "sent twice" are indistinguishable when the failure was in the provider's
 * reply rather than in the delivery, and being mailed twice is the one that
 * produces a spam complaint against a domain carrying every seller's order
 * confirmations. The `error` column is why it is a visible miss and not a
 * silent one.
 *
 * SCALE, honestly. This reads a page of candidates per tick rather than every
 * user, and the page is bounded by `CANDIDATES_PER_TICK`. What keeps that
 * page from filling permanently with accounts that will never be due anything
 * is the retirement tombstone below — without it, the oldest dead signups
 * would sit at the front of every tick's page forever and starve the people
 * who signed up this morning.
 */

/**
 * The quiet a seller is owed between two of these.
 *
 * Twenty hours rather than twenty-four so that a daily rhythm does not drift
 * an hour later each day and eventually land at 3am. It is the only thing
 * making this a sequence rather than a burst: several rungs come due at once
 * for a seller who does everything in one sitting, and without pacing they
 * would arrive together and read as a malfunction.
 */
export const PACING_HOURS = 20;

/** Rows read per tick. A ceiling on the work, not on the sending. */
const CANDIDATES_PER_TICK = 500;

/** Emails sent per tick. Hourly ticks make this a generous daily figure. */
const MAX_SENDS_PER_PASS = 200;

/**
 * The platform's daily budget for its own marketing.
 *
 * Configurable because the right number is whatever the Resend plan allows,
 * and that changes without a deploy. The default is deliberately modest: an
 * over-tight ceiling delays mail and is visible in this function's return
 * value, and an over-loose one gets the sending domain blocked, which is not
 * visible until sellers start asking why buyers never got their receipts.
 */
function platformCeiling(): number {
  const raw = Number(process.env.LIFECYCLE_DAILY_CEILING);
  return Number.isFinite(raw) && raw > 0 ? raw : 5_000;
}

export type LifecyclePassResult = {
  /** Rows the candidate query returned. */
  considered: number;
  /** Claims won and handed to the provider. */
  sent: number;
  failed: number;
  /** Claims lost to a concurrent tick — expected, not an error. */
  raced: number;
  /** Accounts tombstoned as past the pipeline. */
  retired: number;
  /** Set when a ceiling bit, so a short pass is never mistaken for a quiet one. */
  limitedBy: "platform" | "pass" | "candidates" | null;
  /** Set when the pass refused to run at all, with the reason. */
  refused?: string;
};

export async function runLifecyclePass(
  now = new Date(),
): Promise<LifecyclePassResult> {
  const empty: LifecyclePassResult = {
    considered: 0,
    sent: 0,
    failed: 0,
    raced: 0,
    retired: 0,
    limitedBy: null,
  };

  /*
   * The link has to work before a single message goes out.
   *
   * Without a signing secret every unsubscribe link in this pass would be
   * dead — a footer and a `List-Unsubscribe` header both pointing at a route
   * that refuses every token — and mail carrying a broken unsubscribe link is
   * not mail we may send at all. Refusing the whole pass leaves every rung
   * unclaimed, so a later tick in a fixed environment sends them for real.
   */
  if (!marketingOptOutToken({ email: "probe@example.com" })) {
    console.error("[sailo] lifecycle pass refused: no unsubscribe signing secret");
    return { ...empty, refused: "no unsubscribe signing secret" };
  }

  const budget = platformCeiling() - (await lifecycleSentTodayPlatform(now));
  if (budget <= 0) {
    console.warn("[sailo] lifecycle pass held: platform daily ceiling reached");
    return { ...empty, limitedBy: "platform" };
  }

  const candidates = await lifecycleCandidates({
    now,
    pacingHours: PACING_HOURS,
    limit: CANDIDATES_PER_TICK,
  });

  const allowance = Math.min(MAX_SENDS_PER_PASS, budget);
  const due: { state: LifecycleState; step: LifecycleStepId }[] = [];
  const retire: LifecycleState[] = [];
  let heldByAllowance = false;

  for (const state of candidates) {
    const step = nextLifecycleStep(state, now);
    if (step) {
      /*
       * Over the allowance the seller is *skipped*, not dropped: nothing has
       * been claimed for them, so the next tick finds the same rung due and
       * sends it an hour late. Recorded so the return value says a ceiling
       * bit rather than implying the queue was empty — the repo's own rule
       * that a clamped result must say it was clamped.
       */
      if (due.length >= allowance) {
        heldByAllowance = true;
        continue;
      }
      due.push({ state, step: step.id });
      continue;
    }
    if (isRetirable(state, now)) retire.push(state);
  }

  const { sent, failed, raced } = await claimAndSend(due, now);
  const retired = await retireAll(retire);

  return {
    considered: candidates.length,
    sent,
    failed,
    raced,
    retired,
    limitedBy: heldByAllowance
      ? "pass"
      : candidates.length >= CANDIDATES_PER_TICK
        ? "candidates"
        : null,
  };
}

/**
 * Claim every due rung, then send what was actually claimed.
 *
 * The claims happen first and one at a time, because `ON CONFLICT DO NOTHING
 * RETURNING` is the arbitration and its answer is per row. The sending is
 * batched afterwards, because by then the set is fixed and Resend's batch
 * endpoint turns a hundred HTTP round trips into one.
 */
async function claimAndSend(
  due: { state: LifecycleState; step: LifecycleStepId }[],
  now: Date,
) {
  const db = getDb();
  let raced = 0;

  type Claimed = {
    rowId: string;
    state: LifecycleState;
    step: LifecycleStepId;
  };
  const claimed: Claimed[] = [];

  for (const item of due) {
    const [row] = await db
      .insert(lifecycleEmails)
      .values({
        userId: item.state.userId,
        step: item.step,
        email: item.state.email.toLowerCase(),
      })
      .onConflictDoNothing()
      .returning({ id: lifecycleEmails.id });

    /*
     * No row back means another pass got there first. That is the ordinary
     * outcome this index exists to produce, not an error — so it moves on
     * rather than sending a second copy.
     */
    if (!row) {
      raced += 1;
      continue;
    }
    claimed.push({ rowId: row.id, state: item.state, step: item.step });
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < claimed.length; i += MAX_BATCH) {
    const chunk = claimed.slice(i, i + MAX_BATCH);

    const messages = chunk.map((item) => {
      /*
       * Built per recipient, because the token *is* the recipient. The
       * non-null assertion the type would otherwise want is unnecessary: the
       * pass refused at the top if no secret exists, so by here every call
       * returns a string.
       */
      const token = marketingOptOutToken({ email: item.state.email }) ?? "";
      return lifecycleMessage({
        step: item.step,
        state: item.state,
        oneClickUrl: marketingOptOutPostUrl(token),
        pageUrl: marketingOptOutUrl(token),
      });
    });

    const results = await sendBatch(messages);

    for (const [index, item] of chunk.entries()) {
      const result = results[index];
      if (result?.sent) {
        sent += 1;
        await db
          .update(lifecycleEmails)
          .set({ providerId: result.id, sentAt: now, error: null })
          .where(eq(lifecycleEmails.id, item.rowId));
        continue;
      }

      failed += 1;
      await db
        .update(lifecycleEmails)
        .set({ error: (result?.reason ?? "unknown").slice(0, 500) })
        .where(eq(lifecycleEmails.id, item.rowId));
      console.warn(
        `[sailo] lifecycle ${item.step} not sent for user ${item.state.userId}: ${result?.reason ?? "unknown"}`,
      );
    }
  }

  return { sent, failed, raced };
}

/**
 * Tombstones accounts the pipeline has nothing left to say to.
 *
 * A row under a step id that no rung uses, so it can never be mistaken for a
 * message anybody received: `sentAt` stays null, `error` says what it is, and
 * the candidate query skips these accounts from then on.
 *
 * This is what stops the pass reading the same dead accounts every hour
 * forever. The exit is deliberately not permanent — the candidate query lets
 * a tombstoned account back in the moment it has a freshly created shop,
 * which is both the event worth re-engaging on and the only one that puts a
 * rung genuinely within reach again.
 */
async function retireAll(states: LifecycleState[]): Promise<number> {
  if (states.length === 0) return 0;

  const rows = await getDb()
    .insert(lifecycleEmails)
    .values(
      states.map((state) => ({
        userId: state.userId,
        step: RETIRED_STEP,
        email: state.email.toLowerCase(),
        error: "past every rung — nothing due",
      })),
    )
    .onConflictDoNothing()
    .returning({ id: lifecycleEmails.id });

  return rows.length;
}

/**
 * The bounce webhook's way back from a provider id to an address of ours.
 *
 * Kept here rather than inlined in the route so the route stays a route: it
 * verifies a signature and dispatches, and both of the tables that can own a
 * provider id answer through a function of their own.
 */
export async function lifecycleDeliveryByProviderId(providerId: string) {
  return getDb().query.lifecycleEmails.findFirst({
    where: eq(lifecycleEmails.providerId, providerId),
  });
}

/** Marks a delivery as having bounced or drawn a complaint after the fact. */
export async function markLifecycleFailed(rowIds: string[], reason: string) {
  if (rowIds.length === 0) return;
  await getDb()
    .update(lifecycleEmails)
    .set({ error: reason })
    .where(inArray(lifecycleEmails.id, rowIds));
}
