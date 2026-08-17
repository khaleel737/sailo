/**
 * Claiming earnings, and marking a payout failed.
 *
 * The two writes that are not the transfer. `claimEarnings` is the one that makes the whole
 * thing correct under concurrency — an earning that matures between the read and the transfer
 * is either claimed by this run or left for the next, never both and never neither — and
 * `failPayout` is what a crash leaves behind for `../reconcile` to ask about.
 */

import "server-only";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { creatorReferrals, partnerPayouts, referralEarnings } from "@sailo/db/schema";
import type Stripe from "stripe";

export async function claimEarnings(
  payoutId: string,
  partnerId: string,
  currency: string,
): Promise<{ cents: number; rows: number }> {
  const claimed = await getDb()
    .update(referralEarnings)
    .set({ payoutId })
    .where(
      and(
        isNull(referralEarnings.paidOutAt),
        isNull(referralEarnings.payoutId),
        lte(referralEarnings.matureAt, new Date()),
        eq(referralEarnings.currency, currency),
        sql`${referralEarnings.referralId} in (
          select ${creatorReferrals.id} from ${creatorReferrals}
          where ${creatorReferrals.partnerId} = ${partnerId}
        )`,
      ),
    )
    .returning({ amountCents: referralEarnings.amountCents });

  return {
    cents: claimed.reduce((sum, row) => sum + row.amountCents, 0),
    rows: claimed.length,
  };
}

/** Puts claimed rows back in the pool after a refusal. */
async function releaseClaim(payoutId: string): Promise<void> {
  await getDb()
    .update(referralEarnings)
    .set({ payoutId: null })
    .where(
      and(
        eq(referralEarnings.payoutId, payoutId),
        // Never un-claim something that actually settled. Belt and braces:
        // this path is only reached on failure, but a release that could
        // touch a paid row would be unrecoverable.
        isNull(referralEarnings.paidOutAt),
      ),
    );
}

/** Marks a payout failed and frees the rows it was holding. */
export async function failPayout(payoutId: string, reason: string): Promise<void> {
  await getDb()
    .update(partnerPayouts)
    .set({ status: "failed", failureReason: reason.slice(0, 500) })
    .where(eq(partnerPayouts.id, payoutId));
  await releaseClaim(payoutId);
}

/** Marks a payout paid and stamps every row it settled. */
export async function settlePayout(
  payoutId: string,
  transfer: Stripe.Transfer,
): Promise<void> {
  const db = getDb();
  const now = new Date();

  await db
    .update(partnerPayouts)
    .set({ status: "paid", stripeTransferId: transfer.id, paidAt: now })
    .where(eq(partnerPayouts.id, payoutId));

  await db
    .update(referralEarnings)
    .set({ paidOutAt: now })
    .where(
      and(eq(referralEarnings.payoutId, payoutId), isNull(referralEarnings.paidOutAt)),
    );
}
