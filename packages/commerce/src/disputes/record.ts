import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { disputes, earlyFraudWarnings, orders, shops } from "@sailo/db/schema";
import { acceptsStatusChange, isInquiry } from "@sailo/core/disputes";
import { orderForIntent } from "@sailo/payments";
import type { NormalizedDispute } from "@sailo/payments/disputes";

/**
 * Writing a dispute down, once, whatever order the webhooks arrive in.
 *
 * Five Stripe events describe one dispute — `created`, `updated`, `closed`,
 * `funds_withdrawn`, `funds_reinstated` — under five different event ids, so the
 * `stripeEvents` claim in the webhook route does not help here: each id is
 * legitimately new. Two things make this safe instead:
 *
 *   - `disputes_stripe_id_key`, a unique index, so five events cannot become
 *     five rows. One chargeback recorded five times is a dispute rate five times
 *     its real value, which would hold a seller's payouts for arithmetic.
 *   - `acceptsStatusChange`, so a retry of an earlier delivery cannot walk a
 *     decided dispute backwards. Stripe delivers at least once and in no
 *     guaranteed order; without this an `updated` carrying `needs_response` that
 *     arrives after the `closed` carrying `won` reopens the case, puts the
 *     deadline back on the seller's dashboard and tells them reinstated money is
 *     gone again.
 */

export type DisputeScope = "connected" | "platform";

export type RecordedDispute = {
  id: string;
  shopId: string | null;
  orderId: string | null;
  scope: DisputeScope;
  status: string;
  /** False when an out-of-order delivery was declined. */
  applied: boolean;
  /**
   * The row as it now stands, from the write that just made it so.
   *
   * Returned rather than left for the caller to re-read, because every caller
   * needs it and the write already had it in hand: the webhook has to decide
   * which notification a seller is owed, and that turns on the amount, the fee
   * and the deadline this statement just settled. A `findFirst` afterwards is
   * both a second round trip on a path Stripe is waiting on and a chance to read
   * a *different* row — a concurrent delivery can land in between.
   */
  row: typeof disputes.$inferSelect;
};

/**
 * Find the shop and order a dispute belongs to.
 *
 * Three routes, tried in the order they are reliable:
 *
 *   1. The payment intent, which is what `orderForIntent` already resolves and
 *      what every card sale carries.
 *   2. The charge, for the case where the intent is absent — which happens on
 *      disputes against charges created outside Checkout.
 *   3. Nothing, which is a real outcome and must not throw. A dispute against a
 *      charge Sailo has no record of is still a dispute against the platform's
 *      account, still counts towards the platform's ratio, and still has to be
 *      recorded — an unmatched dispute that is dropped is a dispute nobody ever
 *      responds to.
 */
async function locate(
  dispute: NormalizedDispute,
  accountId: string | null,
): Promise<{ shopId: string | null; orderId: string | null }> {
  const db = getDb();

  /*
   * Through `orderForIntent`, never a direct query.
   *
   * It is the only route from a charge to an order, and it scopes the match to
   * the account that sent the event. A direct `findFirst` on
   * `stripePaymentIntentId` is the shape of a bug that was already fixed once:
   * `charge.refunded` did exactly that and let a seller mark another shop's
   * order refunded from their own connected account. Every seller controls their
   * own Stripe account, so an event naming an order proves nothing about who
   * sent it.
   */
  const byIntent = await orderForIntent(dispute.stripePaymentIntentId, accountId);
  if (byIntent) return { shopId: byIntent.shopId, orderId: byIntent.id };

  /*
   * The connected account, when no order matched.
   *
   * A seller can take a payment from Stripe's own dashboard, and a dispute
   * against it has no Sailo order at all. It is still that shop's chargeback and
   * still belongs in their rate — Visa counts it against the platform either
   * way — so the shop is resolved from the account even when the order cannot be.
   */
  if (accountId) {
    const shop = await db.query.shops.findFirst({
      where: eq(shops.stripeAccountId, accountId),
      columns: { id: true },
      /*
       * Ordered, because nothing makes `stripeAccountId` unique.
       *
       * One connected account belongs to one shop and the app's data says so,
       * but the column carries only an index — see the note on it in `shop.ts`.
       * Without an order, two shops sharing an account would have their disputes
       * filed against whichever row Postgres happened to return, and the answer
       * could change between the recording and the assessment. The oldest shop
       * is the arbitrary-but-stable choice, and stable is the property that
       * matters: a dispute must not move between shops on a retry.
       */
      orderBy: (row, { asc }) => asc(row.createdAt),
    });
    if (shop) return { shopId: shop.id, orderId: null };
  }

  return { shopId: null, orderId: null };
}

/**
 * Record or update one dispute.
 *
 * `scope` is taken from the caller rather than inferred from `accountId`, because
 * the inference is wrong in the one case that matters: a shop whose Stripe
 * account *is* the platform's own — which `actingAs` supports so the whole flow
 * can be exercised end to end — produces a connected-account dispute with no
 * account id. Guessing `platform` there would file a buyer's chargeback as a
 * subscription one and leave it out of the shop's rate entirely.
 */
export async function recordDispute(opts: {
  dispute: NormalizedDispute;
  accountId: string | null;
  scope: DisputeScope;
  /** Overrides the located shop, for a platform dispute resolved by customer. */
  shopId?: string | null;
  occurredAt: Date;
}): Promise<RecordedDispute> {
  const db = getDb();
  const { dispute, accountId, scope } = opts;

  const located = await locate(dispute, accountId);
  const shopId = opts.shopId !== undefined ? opts.shopId : located.shopId;

  const existing = await db.query.disputes.findFirst({
    where: eq(disputes.stripeDisputeId, dispute.stripeDisputeId),
  });

  const fundsOut = dispute.fundsOut;
  const shared = {
    scope,
    shopId,
    orderId: located.orderId,
    stripeChargeId: dispute.stripeChargeId,
    stripePaymentIntentId: dispute.stripePaymentIntentId,
    stripeAccountId: accountId,
    amountCents: dispute.amountCents,
    currency: dispute.currency,
    feeCents: dispute.feeCents,
    deductedCents: dispute.deductedCents,
    reason: dispute.reason,
    networkReasonCode: dispute.networkReasonCode,
    network: dispute.network,
    caseType: dispute.caseType,
    status: dispute.status,
    dueBy: dispute.dueBy,
    submissionCount: dispute.submissionCount,
    enhancedEligibility: dispute.enhancedEligibility,
    stripeUpdatedAt: opts.occurredAt,
    updatedAt: new Date(),
  };

  if (!existing) {
    const [row] = await db
      .insert(disputes)
      .values({
        ...shared,
        stripeDisputeId: dispute.stripeDisputeId,
        stripeCreatedAt: dispute.stripeCreatedAt,
        ...(fundsOut ? { fundsWithdrawnAt: opts.occurredAt } : {}),
      })
      /*
       * A concurrent delivery of the same dispute under a different event id.
       * Two `charge.dispute.created` retries can be in flight at once and both
       * pass the `findFirst` above; the unique index turns the loser into a
       * no-op rather than a 500 that has Stripe retry forever.
       */
      .onConflictDoNothing({ target: disputes.stripeDisputeId })
      .returning();

    if (row) {
      return {
        id: row.id,
        shopId,
        orderId: located.orderId,
        scope,
        status: dispute.status,
        applied: true,
        row,
      };
    }
    // Lost the race. Re-read and fall through to the update path.
    const raced = await db.query.disputes.findFirst({
      where: eq(disputes.stripeDisputeId, dispute.stripeDisputeId),
    });
    if (!raced) throw new Error(`dispute ${dispute.stripeDisputeId} vanished mid-write`);
    return applyUpdate(raced, shared, dispute, opts.occurredAt, scope, shopId, located.orderId);
  }

  return applyUpdate(existing, shared, dispute, opts.occurredAt, scope, shopId, located.orderId);
}

type ExistingDispute = typeof disputes.$inferSelect;

async function applyUpdate(
  existing: ExistingDispute,
  shared: Record<string, unknown>,
  dispute: NormalizedDispute,
  occurredAt: Date,
  scope: DisputeScope,
  shopId: string | null,
  orderId: string | null,
): Promise<RecordedDispute> {
  const db = getDb();

  const accepted = acceptsStatusChange(
    { status: existing.status, stripeUpdatedAt: existing.stripeUpdatedAt },
    { status: dispute.status, occurredAt },
  );

  if (!accepted) {
    /*
     * The status is stale, but the money may not be.
     *
     * `funds_withdrawn` and `funds_reinstated` carry the same status as the
     * event before them, so `acceptsStatusChange` declines them — correctly, for
     * the status. The deduction they carry is new information and is the number
     * HQ needs most, so it is written even when the status is not. Guarded by
     * `> existing`, so a re-delivery cannot add the fee twice.
     */
    if (dispute.deductedCents > existing.deductedCents) {
      await db
        .update(disputes)
        .set({
          feeCents: dispute.feeCents,
          deductedCents: dispute.deductedCents,
          fundsWithdrawnAt: existing.fundsWithdrawnAt ?? occurredAt,
          updatedAt: new Date(),
        })
        .where(eq(disputes.id, existing.id));
    }
    return {
      id: existing.id,
      shopId: existing.shopId,
      orderId: existing.orderId,
      scope: existing.scope as DisputeScope,
      status: existing.status,
      applied: false,
      row: existing,
    };
  }

  const reinstated = existing.fundsWithdrawnAt && !dispute.fundsOut;

  const [updated] = await db
    .update(disputes)
    .set({
      ...shared,
      /*
       * Never un-set. `fundsWithdrawnAt` is a record that money left on a date,
       * not a flag for whether it is currently out — a won dispute still had its
       * funds withdrawn, and the accounting for the month it happened in depends
       * on that date surviving the win.
       */
      fundsWithdrawnAt:
        existing.fundsWithdrawnAt ?? (dispute.fundsOut ? occurredAt : null),
      ...(reinstated ? { fundsReinstatedAt: occurredAt } : {}),
      /*
       * Preserve a located order rather than overwriting it with a later null.
       * A `closed` event can arrive after the order row has been reassigned or
       * its intent cleared, and losing the link would orphan the dispute from
       * the cohort it belongs to.
       */
      orderId: orderId ?? existing.orderId,
      shopId: shopId ?? existing.shopId,
    })
    .where(eq(disputes.id, existing.id))
    .returning();

  return {
    id: existing.id,
    shopId: shopId ?? existing.shopId,
    orderId: orderId ?? existing.orderId,
    scope,
    status: dispute.status,
    applied: true,
    row: updated ?? existing,
  };
}

/**
 * What an order's payment status should become, given a dispute.
 *
 * Pulled out of the webhook handler because it was the site of the bug: the
 * handler set `disputed` on every `charge.dispute.created`, inquiries included,
 * and treated every non-`won` close as a loss.
 *
 * An inquiry moves nothing. No money has left the balance — verified in test
 * mode: `balance_transactions: []`, `is_charge_refundable: true` — so an order
 * marked `disputed` on an inquiry tells the seller they have lost a sale they
 * have not lost, and `SELLER_SETTABLE_PAYMENT_STATUSES` deliberately withholds
 * the status they would need to correct it.
 */
export function paymentStatusForDispute(
  dispute: { status: string },
  current: string,
): { paymentStatus?: string; status?: string; note: string } {
  if (isInquiry(dispute.status)) {
    return {
      note: "inquiry — no funds withdrawn, order untouched",
    };
  }

  switch (dispute.status) {
    case "needs_response":
    case "under_review":
      return { paymentStatus: "disputed", note: "chargeback open — funds withdrawn" };
    case "won":
      /*
       * Back to paid, and only from `disputed`. A dispute won on an order the
       * seller has since refunded by hand must not be dragged back to paid.
       */
      return current === "disputed"
        ? { paymentStatus: "paid", note: "chargeback won — funds reinstated" }
        : { note: `chargeback won, order left at ${current}` };
    case "lost":
      return {
        paymentStatus: "refunded",
        status: "refunded",
        note: "chargeback lost — money gone",
      };
    case "prevented":
      /*
       * Deflected before it became a chargeback — Visa Order Insight, RDR,
       * Ethoca. The seller kept the money, so the order goes back to paid for
       * the same reason `won` does.
       */
      return current === "disputed"
        ? { paymentStatus: "paid", note: "dispute prevented — sale stands" }
        : { note: "dispute prevented — sale stands" };
    default:
      return { note: `no order change for status ${dispute.status}` };
  }
}

/**
 * Record an early fraud warning.
 *
 * The only advance notice anybody gets: the issuer has told the network the
 * cardholder called this fraud, and a chargeback usually follows within days.
 * Refunding on one avoids the chargeback *and* the $15 fee — but not the fraud
 * report itself, which still counts towards Visa's VAMP fraud component. So this
 * is not a way to keep a rate clean; it is a way to stop losing the goods as
 * well as the money, and a shop generating warnings is a shop with a problem
 * before any dispute has arrived.
 */
export async function recordEarlyFraudWarning(opts: {
  stripeWarningId: string;
  stripeChargeId: string | null;
  stripeAccountId: string | null;
  fraudType: string;
  actionable: boolean;
  stripeCreatedAt: Date;
  paymentIntentId: string | null;
}): Promise<{ id: string | null; shopId: string | null; orderId: string | null }> {
  const db = getDb();

  const order = opts.paymentIntentId
    ? await db.query.orders.findFirst({
        where: eq(orders.stripePaymentIntentId, opts.paymentIntentId),
        columns: { id: true, shopId: true },
      })
    : undefined;

  let shopId = order?.shopId ?? null;
  if (!shopId && opts.stripeAccountId) {
    const shop = await db.query.shops.findFirst({
      where: eq(shops.stripeAccountId, opts.stripeAccountId),
      columns: { id: true },
    });
    shopId = shop?.id ?? null;
  }

  const [row] = await db
    .insert(earlyFraudWarnings)
    .values({
      shopId,
      orderId: order?.id ?? null,
      stripeWarningId: opts.stripeWarningId,
      stripeChargeId: opts.stripeChargeId,
      stripeAccountId: opts.stripeAccountId,
      fraudType: opts.fraudType,
      actionable: opts.actionable ? "true" : "false",
      stripeCreatedAt: opts.stripeCreatedAt,
    })
    .onConflictDoNothing({ target: earlyFraudWarnings.stripeWarningId })
    .returning({ id: earlyFraudWarnings.id });

  return { id: row?.id ?? null, shopId, orderId: order?.id ?? null };
}

/**
 * Tie a dispute back to the warning that predicted it.
 *
 * The measurement that says whether acting on warnings is worth anything: an
 * EFW that became a chargeback is one nobody refunded in time. Matched on the
 * charge, which both objects carry.
 */
export async function linkWarningToDispute(
  chargeId: string | null,
  disputeId: string,
): Promise<void> {
  if (!chargeId) return;
  await getDb()
    .update(earlyFraudWarnings)
    .set({ disputeId })
    .where(
      and(
        eq(earlyFraudWarnings.stripeChargeId, chargeId),
        isNull(earlyFraudWarnings.disputeId),
      ),
    );
}
