import "server-only";
import { and, eq, exists, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { disputes, riskFlags, shops, type Shop } from "@sailo/db/schema";
import {
  assessShop,
  isAutomatic,
  suspensionWarranted,
  type EscalationDecision,
  type ShopRisk,
} from "@sailo/core/disputes";
import {
  holdPayouts,
  readBalance,
  readPayoutState,
  releasePayouts,
  type PayoutInterval,
} from "@sailo/payments/disputes";
import { chargebacksSince, shopDisputeStats, type ShopDisputeStats } from "./stats";

/**
 * Deciding what to do about a shop's disputes, and doing it.
 *
 * The decision is `assessShop`, which is pure and lives in `@sailo/core`. This
 * file is the half that touches Stripe and the database, and it is deliberately
 * thin: everything interesting about the ladder — the floors, the exposure
 * arithmetic, the fact that nothing automatic may reach `suspend` — is tested
 * without either.
 *
 * The one rule enforced here rather than there: **this function never suspends a
 * storefront.** `assessShop` cannot return `suspend`, and `applyEscalation`
 * refuses it a second time even if it did. Closing a shop is a judgement about
 * whether this is a fraud ring or a seller who had a terrible month, the cost of
 * being wrong falls entirely on a real business, and no threshold gets to make
 * it.
 */

export type EscalationOutcome = {
  decision: EscalationDecision;
  stats: ShopDisputeStats;
  /** What actually changed, for the audit line and the caller's log. */
  applied: "payouts_held" | "payouts_released" | "flagged" | "nothing";
  /** Set when Stripe refused; the decision stands and the money did not move. */
  error?: string;
  /** Whether /hq should offer a human the suspension button. */
  suspensionWarranted: boolean;
};

/**
 * Assemble the risk picture: the rate from our rows, the balance from Stripe.
 *
 * The balance has to come from Stripe and cannot be inferred. Sailo does not
 * mirror connected-account balances — payouts, refunds and Stripe's own fees all
 * move them without a webhook Sailo reads — so an exposure calculation built from
 * order totals would be a guess about the number that decides whether Sailo
 * covers a shortfall.
 *
 * Fails towards holding. When the balance cannot be read, it is treated as zero,
 * which makes the whole open-dispute amount look unrecoverable and biases the
 * decision towards a payout hold. That is the right direction to be wrong in: a
 * held payout is reversed with one call, and money paid out against disputes that
 * Sailo then covers is recovered under Terms clause 5, second, if at all.
 */
export async function riskFor(
  shop: Shop,
  now = new Date(),
): Promise<{ risk: ShopRisk; stats: ShopDisputeStats }> {
  const stats = await shopDisputeStats(shop.id, now);

  const balance = shop.stripeAccountId
    ? await readBalance(shop.stripeAccountId, shop.currency ?? "USD")
    : null;

  /*
   * Counted by the disputes' own timestamps — see `chargebacksSince` for why
   * the pooled-delta arithmetic this replaces could break a clearance on old
   * news. Only asked at all when a clearance stands.
   */
  const sinceClearance = shop.disputeClearedAt
    ? await chargebacksSince(shop.id, shop.disputeClearedAt)
    : 0;

  return {
    stats,
    risk: {
      chargebackBp: stats.chargebackBp,
      settledOrders: stats.settledOrders,
      tally: stats.tally,
      emergingChargebacks: stats.emergingChargebacks,
      exposure: {
        openDisputeCents: stats.openDisputeCents,
        /*
         * Available plus pending. Both cover an open dispute: it will not resolve
         * for weeks and the pending balance will have landed by then. Reporting
         * only `available` would overstate every shortfall on a shop that had
         * just made a sale.
         */
        balanceCents: balance ? balance.availableCents + balance.pendingCents : 0,
        negativeBalanceCents: balance?.negativeCents ?? 0,
      },
      clearedAt: shop.disputeClearedAt,
      chargebacksSinceClearance: sinceClearance,
    },
  };
}

/**
 * Assess a shop and apply whatever the assessment allows.
 *
 * Called after every dispute event, and cheap enough to be: two queries and one
 * Stripe balance read. Not scheduled, deliberately — a nightly sweep would leave
 * a shop's payout window open for up to a day after the chargeback that should
 * have closed it, and the payout run is the thing being raced.
 */
export async function applyEscalation(
  shop: Shop,
  now = new Date(),
): Promise<EscalationOutcome> {
  const db = getDb();
  const { risk, stats } = await riskFor(shop, now);
  const decision = assessShop(risk);

  const held = Boolean(shop.payoutsPausedAt);
  const warranted = suspensionWarranted(risk, held);

  /*
   * Belt and braces. `assessShop` cannot return `suspend` — `escalation.test.ts`
   * asserts it exhaustively — and this refuses it anyway. The guarantee is worth
   * more than the line costs: the next person to add a rung to that ladder should
   * have to change two files to close a shop automatically.
   */
  if (!isAutomatic(decision.level)) {
    return { decision, stats, applied: "nothing", suspensionWarranted: warranted };
  }

  if (decision.level === "payout_hold") {
    if (held) {
      /*
       * Already held — according to our column. Check Stripe before believing it.
       *
       * The two can drift, and only in the direction that costs money: a seller
       * who asks Stripe support to resume payouts, or a platform operator who
       * changes the schedule in the Dashboard, leaves `payoutsPausedAt` set on a
       * shop whose payouts are running. Every later assessment then takes this
       * branch, refreshes a reason string and re-holds nothing.
       *
       * Found by a live run: an earlier test released payouts directly on the
       * account without clearing the flag, and the next real chargeback did not
       * re-hold them. Reading the account back is one API call on a path that
       * runs a handful of times a month.
       */
      const accountId = shop.stripeAccountId;
      const live = accountId ? await readPayoutState(accountId) : null;

      if (accountId && live && !live.held) {
        const reapplied = await holdPayouts(accountId);
        await db
          .update(shops)
          .set({
            payoutsPausedReason: decision.reason,
            ...(reapplied.ok && reapplied.previousInterval
              ? { payoutIntervalBeforeHold: reapplied.previousInterval }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(shops.id, shop.id));

        return reapplied.ok
          ? { decision, stats, applied: "payouts_held", suspensionWarranted: warranted }
          : {
              decision,
              stats,
              applied: "nothing",
              error: reapplied.error,
              suspensionWarranted: warranted,
            };
      }

      // Genuinely held. Refresh the reason so /hq shows current figures rather
      // than the ones from whenever the first chargeback landed.
      await db
        .update(shops)
        .set({ payoutsPausedReason: decision.reason, updatedAt: new Date() })
        .where(eq(shops.id, shop.id));
      return { decision, stats, applied: "nothing", suspensionWarranted: warranted };
    }

    if (!shop.stripeAccountId) {
      /*
       * Nothing to hold: a shop with no connected account has no payouts and no
       * card sales. Still recorded, so /hq sees the flag — the disputes are real
       * even if the lever is not there.
       */
      await db
        .update(shops)
        .set({
          payoutsPausedAt: now,
          payoutsPausedReason: `${decision.reason} (no connected account to hold)`,
          updatedAt: new Date(),
        })
        .where(eq(shops.id, shop.id));
      return { decision, stats, applied: "flagged", suspensionWarranted: warranted };
    }

    const result = await holdPayouts(shop.stripeAccountId);
    if (!result.ok) {
      /*
       * Stripe refused. The flag is *not* written: a shop marked as held whose
       * payouts are still running is worse than one marked as running, because
       * the next person to look believes the money is safe. The caller logs the
       * error and the next dispute event tries again.
       */
      return {
        decision,
        stats,
        applied: "nothing",
        error: result.error,
        suspensionWarranted: warranted,
      };
    }

    await db
      .update(shops)
      .set({
        payoutsPausedAt: now,
        payoutsPausedReason: decision.reason,
        /*
         * What the seller had, so releasing restores their choice rather than a
         * guess. Null when the account was already on manual — see `holdPayouts`,
         * which refuses to overwrite the remembered interval with `manual` and
         * make the hold permanent.
         */
        payoutIntervalBeforeHold: result.previousInterval,
        updatedAt: new Date(),
      })
      .where(eq(shops.id, shop.id));

    return { decision, stats, applied: "payouts_held", suspensionWarranted: warranted };
  }

  /*
   * Below the hold threshold. Deliberately does *not* release a hold that is
   * already in place.
   *
   * The temptation is symmetry, and it is wrong here. A hold is applied by
   * arithmetic and released by a person, because the arithmetic that lifts it is
   * the same arithmetic that would lift it the moment a shop's oldest cohort
   * ages out of the twelve-month window — returning a fraudulent seller's
   * payouts on a calendar technicality, with no human ever having looked. The
   * release path is `releaseHold` below, called from /hq.
   */
  return {
    decision,
    stats,
    applied: decision.level === "clear" ? "nothing" : "flagged",
    suspensionWarranted: warranted,
  };
}

/**
 * Release a hold, by a person who has looked.
 *
 * Writes the clearance at the same time, so the next automatic assessment does
 * not simply re-apply what was just lifted — that is the loop that teaches
 * everybody to ignore an automated check. The clearance is overridden by two
 * further chargebacks rather than by time; see `CLEARANCE_GRACE_CHARGEBACKS`.
 */
export async function releaseHold(
  shop: Shop,
  opts: { clear: boolean; now?: Date },
): Promise<{ ok: true; interval: PayoutInterval } | { ok: false; error: string }> {
  const now = opts.now ?? new Date();
  const db = getDb();

  if (shop.stripeAccountId) {
    const result = await releasePayouts(
      shop.stripeAccountId,
      (shop.payoutIntervalBeforeHold as PayoutInterval | null) ?? null,
    );
    if (!result.ok) return result;

    const stats = await shopDisputeStats(shop.id, now);
    await db
      .update(shops)
      .set({
        payoutsPausedAt: null,
        payoutsPausedReason: null,
        payoutIntervalBeforeHold: null,
        ...(opts.clear
          ? {
              disputeClearedAt: now,
              disputeChargebacksAtClearance: stats.tally.chargebacks,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(shops.id, shop.id));

    return { ok: true, interval: result.interval };
  }

  await db
    .update(shops)
    .set({
      payoutsPausedAt: null,
      payoutsPausedReason: null,
      ...(opts.clear ? { disputeClearedAt: now } : {}),
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));

  return { ok: true, interval: "daily" };
}


/* --------------------------------------------------------------------------
   The hourly backstop
-------------------------------------------------------------------------- */

/**
 * Re-assesses every shop the per-event path could have left wrong.
 *
 * `applyEscalation` runs on every dispute webhook, deliberately — but three
 * things move the risk picture with no webhook to ride in on, and each of
 * them used to wait for the *next* chargeback, which may be weeks away:
 *
 *   - a `holdPayouts` call Stripe refused ("hold FAILED — payouts still
 *     running") was retried only on the next dispute event;
 *   - the balance drains between events — payouts, refunds, Stripe's own
 *     fees — so a shop can cross the exposure line silently;
 *   - a seller who talks Stripe support into resuming payouts leaves our
 *     column saying held while the money runs (the drift check inside
 *     `applyEscalation` re-holds, but only when it is called).
 *
 * Candidates are shops with an undecided connected dispute or a standing
 * hold — the same populations the assessment reads. Tombstoned shops are
 * excluded: a deletion is blocked while a hold or open dispute stands
 * (`openObligations`), so a tombstone here means the past settled, and it
 * has no payouts to hold.
 *
 * When an assessment says suspension should be put in front of a human, the
 * sweep writes a `risk_flags` row — the desk's inbox — instead of only a log
 * line nobody is paged for. Deduplicated against the open flags so a shop
 * over the line raises one flag, not one per hour.
 */
export async function reassessShopsAtRisk(now = new Date()): Promise<{
  examined: number;
  held: string[];
  holdFailures: { shopId: string; error: string }[];
  suspensionFlagged: string[];
}> {
  const db = getDb();

  const candidates = await db
    .select({ shop: shops })
    .from(shops)
    .where(
      and(
        isNull(shops.deletedAt),
        or(
          isNotNull(shops.payoutsPausedAt),
          exists(
            db
              .select({ one: sql`1` })
              .from(disputes)
              .where(
                and(
                  eq(disputes.shopId, shops.id),
                  eq(disputes.scope, "connected"),
                  sql`${disputes.status} in ('needs_response', 'under_review')`,
                ),
              ),
          ),
        ),
      ),
    )
    .limit(100);

  const out = {
    examined: candidates.length,
    held: [] as string[],
    holdFailures: [] as { shopId: string; error: string }[],
    suspensionFlagged: [] as string[],
  };

  for (const { shop } of candidates) {
    try {
      const outcome = await applyEscalation(shop, now);
      if (outcome.applied === "payouts_held") out.held.push(shop.id);
      if (outcome.error) out.holdFailures.push({ shopId: shop.id, error: outcome.error });

      if (outcome.suspensionWarranted) {
        const flagged = await raiseSuspensionFlag(shop.id, outcome.decision.reason, now);
        if (flagged) out.suspensionFlagged.push(shop.id);
      }
    } catch (error) {
      console.error(`[sailo] reassessment for shop ${shop.id} failed`, error);
    }
  }

  return out;
}

/** One open suspension flag per shop, however many sweeps agree. */
async function raiseSuspensionFlag(
  shopId: string,
  reason: string,
  now: Date,
): Promise<boolean> {
  const db = getDb();

  const existing = await db.query.riskFlags.findFirst({
    where: and(
      eq(riskFlags.shopId, shopId),
      eq(riskFlags.kind, "chargebacks"),
      isNull(riskFlags.clearedAt),
      eq(riskFlags.severity, "act"),
    ),
    columns: { id: true },
  });
  if (existing) return false;

  await db.insert(riskFlags).values({
    shopId,
    kind: "chargebacks",
    severity: "act",
    summary: `Past the point where suspension should be considered: ${reason}`.slice(0, 500),
    raisedAt: now,
  });
  return true;
}
