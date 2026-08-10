import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { creatorReferrals, referralEarnings, shops, user } from "@/db/schema";
import { requireStaff } from "@/lib/session";
import { isPayableBalance } from "@/lib/creator-referrals/program";

/**
 * What Sailo owes creators for the creators they brought us.
 *
 * One question, asked once a month by a human: who has cleared the threshold,
 * and how much do we send them. There is no automated transfer behind this —
 * a referral programme paying itself out is a thing to build after the
 * numbers have been watched for a while, not before.
 *
 * `requireStaff()` here, not only in the /hq layout: Next renders a layout and
 * its page in parallel, so a layout's refusal is no proof this read never ran.
 */

export type ReferrerBalance = {
  shopId: string;
  shopName: string;
  shopHandle: string;
  ownerId: string;
  ownerEmail: string;
  referredCount: number;
  convertedCount: number;
  currency: string;
  lifetimeCents: number;
  unpaidCents: number;
  paidCents: number;
  /** Clear of the stated minimum, so we can send it. */
  payable: boolean;
  /** The most recent thing that moved this balance. */
  lastEarnedAt: Date | null;
};

/**
 * Every referrer who has ever earned anything, biggest debt first.
 *
 * Grouped in Postgres rather than by reading rows into memory: this is the
 * whole platform's ledger, and the answer is a few dozen rows however large
 * it grows. Currency comes out of the grouping too — Sailo bills in one
 * today, and a page that assumes so is a page that starts lying the day that
 * changes.
 */
export async function getReferrerBalances(): Promise<ReferrerBalance[]> {
  await requireStaff();

  const rows = await getDb()
    .select({
      shopId: shops.id,
      shopName: shops.name,
      shopHandle: shops.handle,
      ownerId: shops.userId,
      ownerEmail: user.email,
      currency: referralEarnings.currency,
      lifetimeCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}), 0)`,
      unpaidCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}) filter (where ${referralEarnings.paidOutAt} is null), 0)`,
      paidCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}) filter (where ${referralEarnings.paidOutAt} is not null), 0)`,
      /*
       * Counted over the referral, not the earning: a referrer with three
       * paying creators has three, however many invoices each has produced.
       */
      referredCount: sql<string>`count(distinct ${creatorReferrals.id})`,
      convertedCount: sql<string>`count(distinct ${creatorReferrals.id}) filter (where ${creatorReferrals.convertedAt} is not null)`,
      lastEarnedAt: sql<Date | null>`max(${referralEarnings.createdAt})`,
    })
    .from(referralEarnings)
    .innerJoin(
      creatorReferrals,
      eq(creatorReferrals.id, referralEarnings.referralId),
    )
    .innerJoin(shops, eq(shops.id, creatorReferrals.referrerShopId))
    .innerJoin(user, eq(user.id, shops.userId))
    .groupBy(
      shops.id,
      shops.name,
      shops.handle,
      shops.userId,
      user.email,
      referralEarnings.currency,
    )
    .orderBy(
      desc(
        sql`coalesce(sum(${referralEarnings.amountCents}) filter (where ${referralEarnings.paidOutAt} is null), 0)`,
      ),
    );

  return rows.map((row) => {
    const unpaidCents = Number(row.unpaidCents);
    return {
      shopId: row.shopId,
      shopName: row.shopName,
      shopHandle: row.shopHandle,
      ownerId: row.ownerId,
      ownerEmail: row.ownerEmail,
      currency: row.currency,
      referredCount: Number(row.referredCount),
      convertedCount: Number(row.convertedCount),
      lifetimeCents: Number(row.lifetimeCents),
      unpaidCents,
      paidCents: Number(row.paidCents),
      // The same predicate the seller's card quotes — see `isPayableBalance`.
      payable: isPayableBalance(unpaidCents),
      lastEarnedAt: row.lastEarnedAt ? new Date(row.lastEarnedAt) : null,
    };
  });
}

/**
 * Stamps a referrer's unpaid rows as sent.
 *
 * Idempotent by the `is null` in the WHERE, which is what makes a
 * double-clicked button harmless: the second press matches no rows rather
 * than re-stamping the first press's payout with a later date and losing the
 * record of when the money actually went.
 *
 * Amounts are never touched. The rows say what was earned; this says when it
 * was settled.
 *
 * Returns what was actually stamped rather than a count alone, so the audit
 * line records the sum the database settled instead of a figure posted by a
 * browser that may have been looking at a staler balance.
 */
export async function markReferralsPaid(
  referrerShopId: string,
): Promise<{ rows: number; cents: number; currency: string | null }> {
  await requireStaff();

  const paid = await getDb()
    .update(referralEarnings)
    .set({ paidOutAt: new Date() })
    .where(
      and(
        isNull(referralEarnings.paidOutAt),
        sql`${referralEarnings.referralId} in (
          select ${creatorReferrals.id} from ${creatorReferrals}
          where ${creatorReferrals.referrerShopId} = ${referrerShopId}
        )`,
      ),
    )
    .returning({
      amountCents: referralEarnings.amountCents,
      currency: referralEarnings.currency,
    });

  return {
    rows: paid.length,
    cents: paid.reduce((sum, row) => sum + row.amountCents, 0),
    currency: paid[0]?.currency ?? null,
  };
}
