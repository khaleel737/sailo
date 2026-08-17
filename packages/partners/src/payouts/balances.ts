/**
 * What each partner is owed, and whether they can be paid it.
 *
 * Read-only, and separated for exactly that reason: HQ renders this on every visit to the
 * payouts screen, and nothing in it moves money. A reader asking "can opening this page cause
 * a transfer" gets their answer from the imports.
 */

import "server-only";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { creatorReferrals, partners, referralEarnings } from "@sailo/db/schema";

export type PayoutOutcome =
  | { ok: true; payoutId: string; amountCents: number; currency: string; transferId: string }
  | { ok: false; reason: string; payoutId?: string };

/** One partner's sendable balance in one currency. */
export type PayableBalance = {
  partnerId: string;
  partnerName: string;
  currency: string;
  availableCents: number;
};

/**
 * Everyone we could pay right now, in every currency they've earned in.
 *
 * Grouped in Postgres rather than by reading the ledger into memory: this is
 * the whole platform's ledger and the answer is a few dozen rows however large
 * it grows. Currency comes out of the grouping too — Sailo bills in one today,
 * and a payout run that assumes so is one that starts sending the wrong amount
 * the day that changes.
 *
 * "Available" here means the same thing it means everywhere else: unpaid,
 * unclaimed, and out of the hold period. The `payout_id is null` term is what
 * stops a run from counting rows another run is mid-way through sending.
 */
export async function getPayableBalances(): Promise<PayableBalance[]> {
  const rows = await getDb()
    .select({
      partnerId: partners.id,
      partnerName: partners.name,
      currency: referralEarnings.currency,
      availableCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}), 0)`,
    })
    .from(referralEarnings)
    .innerJoin(
      creatorReferrals,
      eq(creatorReferrals.id, referralEarnings.referralId),
    )
    .innerJoin(partners, eq(partners.id, creatorReferrals.partnerId))
    .where(
      and(
        isNull(referralEarnings.paidOutAt),
        isNull(referralEarnings.payoutId),
        lte(referralEarnings.matureAt, new Date()),
      ),
    )
    .groupBy(partners.id, partners.name, referralEarnings.currency);

  return rows
    .map((row) => ({
      partnerId: row.partnerId,
      partnerName: row.partnerName,
      currency: row.currency,
      availableCents: Number(row.availableCents),
    }))
    .filter((row) => row.availableCents > 0)
    .toSorted((a, b) => b.availableCents - a.availableCents);
}

/**
 * Stamps `payout_id` on every row this payout is going to settle, and reports
 * what it actually got.
 *
 * The atomic gate. Two runs firing at once cannot claim the same row, because
 * `payout_id is null` is evaluated by Postgres inside the UPDATE — the loser
 * sees the row already claimed and simply doesn't get it. That is also why the
 * total is recomputed from the RETURNING rows instead of trusting the figure
 * the caller read a moment earlier.
 *
 * Note it does *not* set `paid_out_at`. The rows are spoken for, not settled;
 * if Stripe refuses, `releaseClaim` puts them back.
 */
