import "server-only";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { subscriptions, type Subscription } from "@sailo/db/schema";

/**
 * Telling a member their payment failed, before Stripe gives up — spec 49.
 *
 * Sailo's grace rule was already right: a `past_due` card member keeps access
 * while Stripe retries, and a manual one does not because nothing is retrying.
 * What was missing is **telling anybody**. A member whose card expired finds
 * out when the door does not open, which is the worst possible moment and the
 * one that produces a chargeback rather than a new card.
 *
 * THIS IS SPEC 32'S SIBLING, NOT ITS DUPLICATE
 *
 * 32 recovers a checkout that never completed; this recovers a renewal that
 * already existed. Same email discipline, different trigger, and neither may
 * double-send.
 *
 * WHY EVERY SEND IS CLAIMED
 *
 * `invoice.payment_failed` is delivered at least once and out of order —
 * Stripe's own retry schedule fires it three or four times over two weeks, and
 * a member who receives four identical "your card failed" emails in an hour
 * rings their bank. The claim is the `sellerOpenedNotifiedAt` pattern on
 * `disputes`: a conditional UPDATE that both counts the attempt and decides
 * whether this caller is the one that sends.
 *
 * WHAT SAILO MUST NOT DO HERE
 *
 * Collect a card. The member's email links to **Stripe's own billing portal**,
 * because a form of ours would let a button say "fixed" while the charge keeps
 * failing — and the member would then believe the problem was ours.
 */

/**
 * How many times a member is told before we stop.
 *
 * Three, which is Easytools' number and, more usefully, roughly Stripe's own
 * retry schedule: past that the subscription is going to be cancelled by the
 * billing side anyway and a fourth email is asking somebody to fix something
 * that has already ended.
 */
export const MAX_DUNNING_ATTEMPTS = 3;

/**
 * The shortest gap between two dunning emails to one member.
 *
 * Stripe's retries are days apart, so this is not the schedule — it is the
 * floor that stops two deliveries of the *same* failure, or a webhook replay,
 * arriving as two emails minutes apart. Long enough to swallow a retry storm,
 * short enough that a genuine second failure two days later still sends.
 */
export const DUNNING_QUIET_HOURS = 20;

export type DunningClaim =
  | { send: true; attempt: number; final: boolean }
  | { send: false; reason: "exhausted" | "too_soon" | "not_found" };

/**
 * Claims the right to tell this member their payment failed.
 *
 * The whole decision is in the WHERE, so exactly one caller wins it. Two
 * deliveries of one `invoice.payment_failed`, or the manual renewal cron
 * racing a webhook, produce one email between them and one increment of the
 * counter — not two of each.
 *
 * Returns the attempt number the winner is sending, so the copy can escalate:
 * the first is "your card was declined", the third is "this is the last time
 * we will try".
 */
export async function claimDunningSend(input: {
  subscriptionId: string;
  now?: Date;
}): Promise<DunningClaim> {
  const db = getDb();
  const now = input.now ?? new Date();
  const quietBefore = new Date(now.getTime() - DUNNING_QUIET_HOURS * 3_600_000);

  const [claimed] = await db
    .update(subscriptions)
    .set({
      dunningAttempts: sql`${subscriptions.dunningAttempts} + 1`,
      dunningLastSentAt: now,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(subscriptions.id, input.subscriptionId),
        // The ceiling, in the WHERE. A fourth delivery finds nothing to update.
        lt(subscriptions.dunningAttempts, MAX_DUNNING_ATTEMPTS),
        /*
         * And the quiet window, in the same statement. Without it two
         * deliveries of one event both pass the ceiling and both send — the
         * counter would be right and the member's inbox would not.
         */
        or(
          isNull(subscriptions.dunningLastSentAt),
          lt(subscriptions.dunningLastSentAt, quietBefore),
        ),
      ),
    )
    .returning({ attempts: subscriptions.dunningAttempts });

  if (!claimed) {
    /*
     * Two reasons a claim fails and they are different facts. `exhausted`
     * means we have said everything we are going to; `too_soon` means this is
     * the same failure arriving again. The caller logs one and ignores the
     * other, and a single boolean would have made them the same line.
     */
    const row = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, input.subscriptionId),
      columns: { dunningAttempts: true },
    });
    if (!row) return { send: false, reason: "not_found" };
    return {
      send: false,
      reason:
        row.dunningAttempts >= MAX_DUNNING_ATTEMPTS ? "exhausted" : "too_soon",
    };
  }

  return {
    send: true,
    attempt: claimed.attempts,
    final: claimed.attempts >= MAX_DUNNING_ATTEMPTS,
  };
}

/**
 * The payment arrived, so the sequence starts over.
 *
 * Not a cosmetic reset. Without it a member whose card failed twice in March
 * and recovered has one attempt left for ever: the next genuine failure, in
 * November, sends one email and then silently gives up on somebody who would
 * have fixed their card.
 *
 * Called from every path that records a successful payment on either rail,
 * beside the period being recorded, so there is no separate thing to remember.
 */
export async function clearDunning(subscriptionId: string): Promise<void> {
  await getDb()
    .update(subscriptions)
    .set({ dunningAttempts: 0, dunningLastSentAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.id, subscriptionId),
        // Only when there is something to clear, so an ordinary renewal does
        // not write a row for nothing on every single period.
        gt(subscriptions.dunningAttempts, 0),
      ),
    );
}

/** What the seller's members list shows about a member in trouble. */
export function dunningState(
  subscription: Pick<Subscription, "status" | "dunningAttempts">,
): { chasing: boolean; attempts: number; exhausted: boolean } {
  const attempts = Math.max(0, subscription.dunningAttempts);
  return {
    chasing: subscription.status === "past_due" && attempts > 0,
    attempts,
    exhausted: attempts >= MAX_DUNNING_ATTEMPTS,
  };
}
