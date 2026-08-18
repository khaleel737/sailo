import "server-only";
import { and, eq, inArray, isNotNull, isNull, ne, notInArray, or } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops, subscriptions } from "@sailo/db/schema";
import { platformFeeBp } from "@sailo/core/plans";
import { SETTLED_STATUSES, feePercentFromBp } from "@sailo/commerce/memberships";
import { setSubscriptionApplicationFee } from "@sailo/commerce/orders/server";

/**
 * Putting Sailo's cut of every membership back in step with the seller's plan.
 *
 * ## The bug this exists for
 *
 * `createSubscriptionSession` sets `application_fee_percent` from
 * `platformFeePercent(shop)` at the moment a member subscribes, and nothing
 * ever set it again -- the parameter appeared in exactly one place in the
 * whole workspace. So the fee did not track the plan, it tracked *the day the
 * member signed up*:
 *
 *   - A seller who moved Free -> Business went on paying 3% on every
 *     membership sold before the upgrade, for the life of that membership,
 *     while the pricing table and their own billing page promised 1%. This is
 *     the direction that matters: it overcharges the sellers who pay us most,
 *     silently and permanently, and it grows with their tenure.
 *   - A seller who moved Business -> Free kept the 1% for ever.
 *
 * Neither is visible to anyone. The fee is deducted inside Stripe's payout, so
 * there is no screen in this product where the two numbers are shown together
 * and no invoice a seller could check them against.
 *
 * `plans.ts` already says this must not happen -- `platformFeePercent` is
 * derived from `platformFeeBp` precisely so that "a membership charged at a
 * different rate from a one-time sale" cannot become "a second fee policy
 * nobody decided on, discovered in a payout months later". That is a
 * description of this bug, written before it was found.
 *
 * ## Why a sweep and not a webhook
 *
 * The expected fee changes at exactly one moment -- when a shop's plan does --
 * so reconciling from the plan-change handler in `stripe-webhooks/platform.ts`
 * is the obvious design, and it is the wrong one. A webhook here awaits its
 * work inline (`after()` is not available in that sense, which
 * `notify-seller-sites.test.ts` states as a rule), so a gym with three hundred
 * members would put three hundred sequential Stripe calls between Stripe's
 * request and our 2xx. Stripe would time out and retry, and the retry would
 * start the same three hundred calls again.
 *
 * A sweep also gets the backlog for free. Every membership sold before this
 * column existed has a null fee and is therefore drifted by definition, so the
 * historical damage and the next plan change are repaired by one code path
 * rather than two -- and the rare path is the common path, so it cannot rot.
 *
 * The lag a sweep costs is affordable in a way a timeout is not: Stripe reads
 * `application_fee_percent` only when it finalises an invoice, and finalisation
 * trails invoice creation by about an hour. An hourly tick converges inside
 * that window for any plan change that is not simultaneous with a renewal, and
 * the worst case is one invoice billed at the old rate on one membership.
 *
 * ## Safe to run twice, and safe to run half
 *
 * Every write is "make this row match its shop's plan", so a second tick over
 * the same rows asks Stripe for a value it already holds and changes nothing.
 * There is no claim and nothing to unwind, because there is no state in
 * flight -- only a difference that is either still there or is not.
 */

/**
 * How many subscriptions one tick may re-point.
 *
 * A ceiling on Stripe calls rather than on shops, because Stripe calls are the
 * only expensive thing here; the queries below are indexed and return nothing
 * once the fleet is in step. 200 matches the manual renewal cron's own limit.
 *
 * It cannot starve the shops it does not reach. Each row this tick fixes stops
 * being drifted, so the next tick's query skips it and the frontier moves
 * forward every hour until the backlog is gone.
 */
const MAX_UPDATES_PER_TICK = 200;

export type FeeReconcileTick = {
  /** Shops whose memberships were queried this tick. */
  shopsChecked: number;
  /**
   * Shops the budget never reached, and about which this tick therefore knows
   * nothing at all.
   *
   * Reported rather than swallowed. A cap that is invisible reads exactly like
   * a fleet already in step, and this sweep corrects a number -- Sailo's cut,
   * taken inside a Stripe payout -- that has no other symptom to notice.
   */
  shopsUnvisited: number;
  /** Subscriptions re-pointed at their shop's current rate. */
  updated: number;
  /** Subscriptions Stripe refused. Left drifted and retried next tick. */
  failed: number;
  /**
   * Whether a shop was cut off part-way through its drifted rows.
   *
   * A flag and not a count, on purpose: the honest count is unobtainable
   * without scanning every shop the budget stopped us reaching, and a number
   * that could only ever report "one more" would read as an exact remainder.
   * At most one shop can be truncated per tick -- the budget hits zero in the
   * same step -- so this says precisely what is knowable.
   */
  truncated: boolean;
};

export async function reconcileMembershipFees(): Promise<FeeReconcileTick> {
  const db = getDb();

  /*
   * Only rows Stripe can still invoice, and only ones there is something to
   * call Stripe about. A membership with no subscription id or no account is
   * either manual -- somebody paying cash at the door, with no fee to set --
   * or a row written before its checkout completed.
   */
  const billable = and(
    eq(subscriptions.billingMode, "stripe"),
    isNotNull(subscriptions.stripeSubscriptionId),
    isNotNull(subscriptions.stripeAccountId),
    notInArray(subscriptions.status, [...SETTLED_STATUSES]),
  );

  /*
   * Not limited, on purpose. This is an index-only scan over
   * `subscriptions_due_idx` returning one row per shop that sells card
   * memberships -- a set bounded by the number of sellers on the tier that
   * unlocks them, not by the number of members they have.
   */
  const candidates = await db
    .selectDistinct({ shopId: subscriptions.shopId })
    .from(subscriptions)
    .where(billable);

  if (candidates.length === 0) {
    return {
      shopsChecked: 0,
      shopsUnvisited: 0,
      updated: 0,
      failed: 0,
      truncated: false,
    };
  }

  /*
   * One query for every shop rather than one per shop. `planFor` needs all
   * three of these columns and `compPlan` is the one that outranks Stripe, so
   * reading only `plan` here would charge a comped seller the Free rate.
   */
  const billing = await db.query.shops.findMany({
    where: inArray(
      shops.id,
      candidates.map((row) => row.shopId),
    ),
    columns: { id: true, plan: true, subscriptionStatus: true, compPlan: true },
  });

  let updated = 0;
  let failed = 0;
  let shopsChecked = 0;
  let truncated = false;
  let budget = MAX_UPDATES_PER_TICK;

  for (const shop of billing) {
    if (budget <= 0) break;
    shopsChecked += 1;

    const expectedBp = platformFeeBp(shop);

    /*
     * `IS DISTINCT FROM`, spelled out. A plain `ne` drops every null, and null
     * is precisely the backlog -- each membership sold before this column
     * existed. Asking for one more row than the budget allows is how
     * `deferred` learns there was more without a second COUNT.
     */
    const drifted = await db.query.subscriptions.findMany({
      where: and(
        eq(subscriptions.shopId, shop.id),
        billable,
        or(
          isNull(subscriptions.applicationFeeBp),
          ne(subscriptions.applicationFeeBp, expectedBp),
        ),
      ),
      columns: {
        id: true,
        stripeSubscriptionId: true,
        stripeAccountId: true,
      },
      limit: budget + 1,
    });

    // One row over the budget is the signal that there were more, not a count.
    if (drifted.length > budget) truncated = true;

    /*
     * Sequential, and the lint warning suggesting `Promise.all` here is wrong.
     * Stripe's write ceiling is 100 operations a second and this loop is the
     * one thing in the tick that spends them; fanning out the whole budget at
     * once would rate-limit the sweep against itself and lose the accounting
     * that makes `deferred` honest. The manual renewal cron is sequential for
     * the same reason and carries the same warning.
     */
    for (const row of drifted.slice(0, budget)) {
      // Narrowing for the compiler; `billable` already excluded both nulls.
      if (!row.stripeSubscriptionId || !row.stripeAccountId) continue;

      try {
        await setSubscriptionApplicationFee({
          accountId: row.stripeAccountId,
          subscriptionId: row.stripeSubscriptionId,
          feePercent: feePercentFromBp(expectedBp),
        });
      } catch (error) {
        /*
         * Swallowed per row, never per tick. The common causes are a seller
         * who disconnected Stripe and a subscription deleted in the seller's
         * own dashboard, and neither is a reason to abandon the other shops in
         * this pass. Nothing is written when the call fails, so the row stays
         * drifted and is tried again next hour -- visibly, through this count.
         */
        console.error("[sailo] membership fee reconcile failed", {
          subscriptionId: row.stripeSubscriptionId,
          error,
        });
        failed += 1;
        budget -= 1;
        continue;
      }

      /*
       * Written here and written again by the webhook.
       *
       * Stripe's `customer.subscription.updated` is what decides this column
       * -- `upsertSubscription` reads it off the event -- but it arrives
       * seconds later, and a tick that did not record its own work would find
       * the same rows drifted and re-send every one of them. The same
       * arrangement, and the same reason, as `cancelMembership`.
       */
      await db
        .update(subscriptions)
        .set({ applicationFeeBp: expectedBp, updatedAt: new Date() })
        .where(eq(subscriptions.id, row.id));

      updated += 1;
      budget -= 1;
    }
  }

  return {
    shopsChecked,
    shopsUnvisited: billing.length - shopsChecked,
    updated,
    failed,
    truncated,
  };
}
