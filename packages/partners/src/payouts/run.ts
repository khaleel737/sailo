/**
 * The scheduled sweep: everybody who is due, one at a time.
 *
 * Sequential rather than concurrent on purpose — a fan-out here is a fan-out of transfers, and
 * Stripe's rate limit is not the thing you want deciding which partners got paid this month.
 */

import "server-only";
import { getProgramSettings } from "../settings";
import { isPayableBalance } from "../program";
import { type PayoutOutcome, getPayableBalances } from "./balances";
import { payPartner, stripeMessage } from "./pay";

export async function runPayouts(params?: {
  initiatedBy?: "auto" | "manual";
  initiatedByEmail?: string;
}): Promise<{
  attempted: number;
  paid: number;
  failed: number;
  skipped: number;
  totalCents: number;
  results: (PayoutOutcome & { partnerId: string; partnerName: string })[];
}> {
  const settings = await getProgramSettings();
  const balances = await getPayableBalances();

  const results: (PayoutOutcome & { partnerId: string; partnerName: string })[] = [];
  let paid = 0;
  let failed = 0;
  let skipped = 0;
  let totalCents = 0;

  for (const balance of balances) {
    if (!isPayableBalance(balance.availableCents, settings.payoutMinimumCents)) {
      skipped++;
      continue;
    }

    let outcome: PayoutOutcome;
    try {
      outcome = await payPartner({
        partnerId: balance.partnerId,
        currency: balance.currency,
        initiatedBy: params?.initiatedBy ?? "auto",
        initiatedByEmail: params?.initiatedByEmail,
      });
    } catch (error) {
      // An unexpected throw is this partner's problem, not the run's.
      outcome = { ok: false, reason: stripeMessage(error) };
      console.error("[sailo] partner payout threw:", balance.partnerId, error);
    }

    if (outcome.ok) {
      paid++;
      totalCents += outcome.amountCents;
    } else {
      failed++;
    }

    results.push({
      ...outcome,
      partnerId: balance.partnerId,
      partnerName: balance.partnerName,
    });
  }

  return {
    attempted: paid + failed,
    paid,
    failed,
    skipped,
    totalCents,
    results,
  };
}

/**
 * Resolves payouts left `pending` by a crash.
 *
 * A `pending` row means we called Stripe — or were about to — and never
 * learned the outcome. Re-sending with the stored idempotency key is the
 * answer to both cases at once: if the original transfer went through, Stripe
 * replays it and we settle the rows we should have settled; if it never
 * happened, this is simply the transfer, made now.
 *
 * Guessing instead — voiding the row, or assuming it failed — is what turns a
 * timeout into either a partner paid twice or a partner never paid at all.
 */
