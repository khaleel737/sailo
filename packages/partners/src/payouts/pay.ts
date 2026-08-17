/**
 * Paying one partner, once.
 *
 * The irreversible one, and the only file here that moves money. The ordering is the design:
 * the payout row is created *before* the transfer so a crash mid-flight leaves something to
 * ask Stripe about under the same idempotency key, and the earnings are claimed before they
 * are totalled.
 */

import "server-only";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { creatorReferrals, partnerPayouts, partners, referralEarnings, shops } from "@sailo/db/schema";
import { maybeRow } from "@sailo/core/invariant";
import { stripe } from "@sailo/payments";
import { canBePaid, payoutBlocker } from "../eligibility";
import { getProgramSettings } from "../settings";
import { isPayableBalance } from "../program";
import type Stripe from "stripe";
import { PAYOUT_BLOCKED } from "./refusals";
import { type PayoutOutcome } from "./balances";
import { claimEarnings, failPayout, settlePayout } from "./claim";

export function stripeMessage(error: unknown): string {
  const err = error as { message?: string; raw?: { message?: string } };
  return err?.raw?.message ?? err?.message ?? "Stripe refused the transfer.";
}

/**
 * Pays one partner one currency's worth of balance.
 *
 * Refuses rather than throws for every condition a human could fix — no
 * Connect account, below the minimum, an unsupported country — because all of
 * them are ordinary states a payout run will meet several times a month and
 * none of them should stop the run reaching the next partner.
 *
 * `initiatedBy` distinguishes the monthly cron from somebody pressing Pay in
 * /hq, which is the first question asked when a partner queries a payment.
 */
export async function payPartner(params: {
  partnerId: string;
  currency: string;
  initiatedBy?: "auto" | "manual";
  initiatedByEmail?: string;
}): Promise<PayoutOutcome> {
  const db = getDb();
  const settings = await getProgramSettings();

  const partner = await db.query.partners.findFirst({
    where: eq(partners.id, params.partnerId),
  });
  if (!partner) return { ok: false, reason: "No such partner." };

  /*
   * Their shop's Stripe account is the destination — the same one their buyers
   * pay into. No subscription test here on purpose: this money was earned
   * under the terms in force when the invoice was paid, and a partner who
   * cancelled last week did not un-earn it. Cancelling stops `canAccrue`; it
   * does not empty the ledger.
   */
  const shop = partner.shopId
    ? await db.query.shops.findFirst({
        where: eq(shops.id, partner.shopId),
        columns: {
          plan: true,
          subscriptionStatus: true,
          compPlan: true,
          stripeAccountId: true,
          stripeChargesEnabled: true,
        },
      })
    : null;

  if (!canBePaid(shop)) {
    return { ok: false, reason: PAYOUT_BLOCKED[payoutBlocker(shop) ?? "no_shop"] };
  }

  const currency = params.currency.toUpperCase();

  /*
   * The pre-flight read. Only a gate — the number that gets sent comes from
   * what the claim below actually took, because this figure is stale the
   * instant it is computed.
   */
  const preview = maybeRow(
    await db
      .select({
        availableCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}), 0)`,
      })
      .from(referralEarnings)
      .innerJoin(
        creatorReferrals,
        eq(creatorReferrals.id, referralEarnings.referralId),
      )
      .where(
        and(
          eq(creatorReferrals.partnerId, partner.id),
          eq(referralEarnings.currency, currency),
          isNull(referralEarnings.paidOutAt),
          isNull(referralEarnings.payoutId),
          lte(referralEarnings.matureAt, new Date()),
        ),
      ),
  );

  const previewCents = Number(preview?.availableCents ?? 0);
  if (!isPayableBalance(previewCents, settings.payoutMinimumCents)) {
    return { ok: false, reason: "Below the payout minimum." };
  }

  /*
   * The key is generated here and stored on the row *before* Stripe sees it,
   * so a retry after a timeout reuses it. Stripe replays the original response
   * for a repeated key, which is what makes "we don't know if it went through"
   * a recoverable state instead of a duplicate payment.
   */
  const idempotencyKey = `partner-payout-${crypto.randomUUID()}`;

  const [payout] = await db
    .insert(partnerPayouts)
    .values({
      partnerId: partner.id,
      amountCents: previewCents,
      currency,
      status: "pending",
      idempotencyKey,
      initiatedBy: params.initiatedBy ?? "auto",
      initiatedByEmail: params.initiatedByEmail ?? null,
    })
    .returning({ id: partnerPayouts.id });

  if (!payout) return { ok: false, reason: "Couldn't open a payout record." };

  const claim = await claimEarnings(payout.id, partner.id, currency);

  /*
   * Between the preview and the claim, a reversal may have landed or another
   * run may have taken the rows. The claim is the truth, so the payout is
   * restated to match it — and abandoned outright if what's left no longer
   * clears the minimum. Sending the preview figure here would transfer money
   * the ledger does not account for.
   */
  if (!isPayableBalance(claim.cents, settings.payoutMinimumCents)) {
    await failPayout(
      payout.id,
      claim.rows === 0
        ? "Nothing left to settle — another payout claimed these earnings first."
        : `Balance fell to ${claim.cents} before the transfer, under the ${settings.payoutMinimumCents} minimum.`,
    );
    return { ok: false, reason: "Balance changed before the transfer.", payoutId: payout.id };
  }

  if (claim.cents !== previewCents) {
    await db
      .update(partnerPayouts)
      .set({ amountCents: claim.cents })
      .where(eq(partnerPayouts.id, payout.id));
  }

  /*
   * `canBePaid` above already established this, but narrowing it here keeps
   * the assertion out of the call and means a future edit that loosens that
   * check fails to compile rather than sending a transfer to nowhere.
   */
  const destination = shop?.stripeAccountId;
  if (!destination) {
    await failPayout(payout.id, "Partner has no connected account.");
    return { ok: false, reason: "They haven't connected a Stripe account.", payoutId: payout.id };
  }

  let transfer: Stripe.Transfer;
  try {
    transfer = await stripe().transfers.create(
      {
        amount: claim.cents,
        currency: currency.toLowerCase(),
        destination,
        description: `Sailo partner commission — ${partner.name}`,
        metadata: { partnerId: partner.id, payoutId: payout.id },
      },
      { idempotencyKey },
    );
  } catch (error) {
    /*
     * The ordinary failure is `balance_insufficient`: the platform balance is
     * short because subscription revenue hasn't settled yet. Stripe does not
     * retry, and adding funds doesn't retry it either — the next run picks the
     * rows up again once `releaseClaim` has put them back.
     */
    await failPayout(payout.id, stripeMessage(error));
    return { ok: false, reason: stripeMessage(error), payoutId: payout.id };
  }

  await settlePayout(payout.id, transfer);

  return {
    ok: true,
    payoutId: payout.id,
    amountCents: claim.cents,
    currency,
    transferId: transfer.id,
  };
}

/**
 * Pays everyone who is owed enough, one at a time.
 *
 * Sequential rather than parallel, deliberately. Every transfer draws on the
 * same platform balance, and firing thirty at once means the ones that fail on
 * insufficient funds are chosen by whichever request Stripe happened to
 * process last. In order, largest first, the shortfall lands on the smallest
 * balances — which are the ones that roll over most gracefully.
 *
 * Never throws. A run that dies on partner nine leaves partners ten onwards
 * unpaid for a month, so every outcome is collected and returned.
 */
