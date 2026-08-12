import "server-only";
import type Stripe from "stripe";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  creatorReferrals,
  partnerPayouts,
  partners,
  referralEarnings,
  shops,
} from "@sailo/db/schema";
import { maybeRow } from "@/lib/invariant";
import { stripe } from "@/lib/stripe";
import { canBePaid, payoutBlocker, type PayoutBlocker } from "./eligibility";
import { getProgramSettings } from "./settings";
import { isPayableBalance } from "./program";

/**
 * Why a payout was refused, in words HQ can act on.
 *
 * Every one of these is an ordinary state a run meets several times a month
 * and none is an error — a refusal names what the seller has to finish, and
 * the run moves to the next partner.
 */
const PAYOUT_BLOCKED: Record<PayoutBlocker, string> = {
  no_shop: "They have no shop — the programme is for active sellers.",
  no_stripe: "Their shop hasn't connected Stripe yet.",
  stripe_incomplete: "Their Stripe account isn't finished verifying.",
};

/**
 * Sending partners their money.
 *
 * The money moves as a plain Stripe **transfer** from Sailo's platform balance
 * to the partner's connected account — no charge behind it, no `transfer_group`,
 * no `source_transaction`. Stripe documents this exact case: *"You can also
 * make a transfer with neither an associated charge nor a transfer_group — for
 * example, when you must pay a provider but there's no associated customer
 * payment."* A partner's commission is not a slice of one buyer's payment; it
 * is a slice of a month of subscription revenue that has already settled into
 * our balance.
 *
 * The ordering below is the whole design, and it is ordered to survive a crash
 * at any line:
 *
 *   1. Write the payout row `pending`, carrying the idempotency key we are
 *      *about to* send Stripe.
 *   2. **Claim** the ledger rows by stamping `payout_id` on them, atomically.
 *   3. Re-total from what was actually claimed, not from what was read.
 *   4. Call Stripe.
 *   5. Stamp `paid_out_at` on the claimed rows, or release the claim on failure.
 *
 * Writing the row first is what makes a crash recoverable: a `pending` row
 * names an attempt whose outcome we do not know, and `reconcilePendingPayouts`
 * asks Stripe with the same key rather than guessing. Creating it *after* the
 * transfer would lose exactly the cases worth keeping.
 *
 * Claiming before totalling is what makes it correct under concurrency: an
 * earning that matures between the read and the transfer is either claimed by
 * this run or left for the next one, never both and never neither.
 */

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
async function claimEarnings(
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
async function failPayout(payoutId: string, reason: string): Promise<void> {
  await getDb()
    .update(partnerPayouts)
    .set({ status: "failed", failureReason: reason.slice(0, 500) })
    .where(eq(partnerPayouts.id, payoutId));
  await releaseClaim(payoutId);
}

/** Marks a payout paid and stamps every row it settled. */
async function settlePayout(
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

function stripeMessage(error: unknown): string {
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
export async function getPartnerPayouts(partnerId: string, limit = 24) {
  return getDb()
    .select({
      id: partnerPayouts.id,
      amountCents: partnerPayouts.amountCents,
      currency: partnerPayouts.currency,
      status: partnerPayouts.status,
      failureReason: partnerPayouts.failureReason,
      initiatedBy: partnerPayouts.initiatedBy,
      createdAt: partnerPayouts.createdAt,
      paidAt: partnerPayouts.paidAt,
    })
    .from(partnerPayouts)
    .where(eq(partnerPayouts.partnerId, partnerId))
    .orderBy(sql`${partnerPayouts.createdAt} desc`)
    .limit(limit);
}
