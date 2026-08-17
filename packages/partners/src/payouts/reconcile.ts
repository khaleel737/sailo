/**
 * Asking Stripe what actually happened to the payouts we are unsure about.
 *
 * The other half of creating the row before the transfer: a payout left pending by a crash is
 * a question, and this answers it rather than leaving a partner's money in a state nobody
 * resolves.
 */

import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { partnerPayouts, partners, shops } from "@sailo/db/schema";
import { stripe } from "@sailo/payments";
import { failPayout, settlePayout } from "./claim";
import { stripeMessage } from "./pay";

export async function reconcilePendingPayouts(): Promise<{
  checked: number;
  settled: number;
  failed: number;
}> {
  const db = getDb();

  const pending = await db
    .select({
      id: partnerPayouts.id,
      partnerId: partnerPayouts.partnerId,
      amountCents: partnerPayouts.amountCents,
      currency: partnerPayouts.currency,
      idempotencyKey: partnerPayouts.idempotencyKey,
      // The seller's own account, reached through the partner's shop.
      stripeAccountId: shops.stripeAccountId,
      partnerName: partners.name,
    })
    .from(partnerPayouts)
    .innerJoin(partners, eq(partners.id, partnerPayouts.partnerId))
    /*
     * A left join, not an inner one. A partner whose shop was deleted still
     * has a pending row, and it has to be *failed* with a reason rather than
     * disappear from the reconciliation — a payout nobody looks at again is
     * how money in flight goes missing.
     */
    .leftJoin(shops, eq(shops.id, partners.shopId))
    .where(eq(partnerPayouts.status, "pending"));

  let settled = 0;
  let failed = 0;

  for (const row of pending) {
    if (!row.stripeAccountId) {
      await failPayout(row.id, "Their shop has no connected Stripe account.");
      failed++;
      continue;
    }

    try {
      const transfer = await stripe().transfers.create(
        {
          amount: row.amountCents,
          currency: row.currency.toLowerCase(),
          destination: row.stripeAccountId,
          description: `Sailo partner commission — ${row.partnerName}`,
          metadata: { partnerId: row.partnerId, payoutId: row.id },
        },
        { idempotencyKey: row.idempotencyKey },
      );
      await settlePayout(row.id, transfer);
      settled++;
    } catch (error) {
      await failPayout(row.id, stripeMessage(error));
      failed++;
    }
  }

  return { checked: pending.length, settled, failed };
}

/** One partner's payout history, newest first — for the portal and for /hq. */
