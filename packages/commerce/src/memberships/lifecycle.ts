import "server-only";
import { and, eq, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  products,
  subscriptions,
  type Subscription,
} from "@sailo/db/schema";
import {
  PAUSED_STATUS,
  intervalOf,
  nextPeriodEnd,
} from "./memberships";
import {
  cancelVerdict,
  pauseVerdict,
  pausedDays,
  periodEndAfterPause,
  termState,
  type CancelVerdict,
  type PauseVerdict,
} from "./terms";

/**
 * What happens to a membership after the first payment — spec 49.
 *
 * Terms, pause, cancellation and switching. Every write here is a *claim*: a
 * conditional UPDATE whose WHERE carries the state it expects to find, so two
 * cron ticks, a webhook retry and a seller clicking twice all do the work once
 * between them. The original memberships release found four defects that were
 * all this shape and none of them by reading.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Any second opinion about access. `membershipAccess` decides that, it gained
 * exactly one branch for the whole of this spec, and everything below moves
 * `status`, `currentPeriodEnd` and `endedReason` — the three columns it has
 * always read. A function in this file that returned a boolean about whether
 * somebody may come in would be the bug.
 */

/* -------------------------------------------------------------------------- */
/*  Fixed term                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The set-clause that records one paid cycle.
 *
 * Returned as a fragment rather than executed, so it can be folded into the
 * **same conditional UPDATE that records the period** — which is the whole
 * point. `renewalOrderedFor` and `orders.membershipPeriodEnd` exist because a
 * seller toggling an order paid → unpaid → paid must buy one month rather than
 * three; a counter incremented in its own statement afterwards has exactly
 * that hazard again, and it fails silently: the member's course finishes two
 * payments early and nobody knows why.
 */
export const countCycle = sql`${subscriptions.cyclesPaid} + 1`;

/**
 * Closes a membership that has finished its term.
 *
 * Called after a cycle is recorded, on both rails. Two things happen and they
 * are separate on purpose:
 *
 *   * **Billing stops.** `cancelAtPeriodEnd` on the row, and on the card rail
 *     the caller sets the same flag on Stripe — Stripe owns the billing clock
 *     and we do not cancel behind its back.
 *   * **`endedReason` becomes `term_complete`**, which is the flag the one new
 *     `membershipAccess` branch reads alongside `accessAfterTerm`. It is what
 *     separates "they finished paying" from "they quit in month two", and
 *     without it a member who cancelled after one payment of twelve would keep
 *     the whole course.
 *
 * Claimed on `ended_reason IS NULL`, so a webhook delivered twice completes a
 * term once.
 */
export async function completeTermIfDone(
  subscriptionId: string,
): Promise<{ completed: boolean; accessRetained: boolean }> {
  const db = getDb();

  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
  });
  if (!row) return { completed: false, accessRetained: false };

  const term = termState(row);
  if (!term.complete) return { completed: false, accessRetained: false };

  const [claimed] = await db
    .update(subscriptions)
    .set({
      status: "canceled",
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
      endedReason: "term_complete",
      updatedAt: new Date(),
    })
    .where(
      and(eq(subscriptions.id, subscriptionId), isNull(subscriptions.endedReason)),
    )
    .returning({ id: subscriptions.id });

  return {
    completed: Boolean(claimed),
    accessRetained: row.accessAfterTerm,
  };
}

/* -------------------------------------------------------------------------- */
/*  Pause                                                                     */
/* -------------------------------------------------------------------------- */

export type PauseResult =
  | { ok: true; until: Date }
  | { ok: false; verdict: Exclude<PauseVerdict, { allowed: true }> }
  | { ok: false; verdict: null };

/**
 * Freezes a membership for `days`.
 *
 * `status` moves to `paused`, and that single write closes the door, the
 * download route, the member's pass and the renewal cron — none of which
 * learned what a pause is, because none of them ever knew what a status is
 * either. See `PAUSED_STATUS` for why this is not a clause inside
 * `membershipAccess`.
 *
 * `pauseDaysUsed` is charged **on resume**, not here: a member who freezes for
 * twenty-eight days and comes back after three has used three, and charging
 * the request rather than the absence would spend a seller's whole allowance
 * on a member who changed their mind.
 *
 * The status guard is in the WHERE, so two tabs freeze once.
 */
export async function pauseMembership(input: {
  shopId: string;
  subscriptionId: string;
  days: number;
  now?: Date;
}): Promise<PauseResult> {
  const db = getDb();
  const now = input.now ?? new Date();

  const row = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, input.subscriptionId),
      eq(subscriptions.shopId, input.shopId),
    ),
  });
  if (!row) return { ok: false, verdict: null };

  const product = row.productId
    ? await db.query.products.findFirst({
        where: eq(products.id, row.productId),
        columns: { pauseMaxDays: true },
      })
    : null;

  const verdict = pauseVerdict(row, { pauseMaxDays: product?.pauseMaxDays ?? null }, input.days, now);
  if (!verdict.allowed) return { ok: false, verdict };

  const [claimed] = await db
    .update(subscriptions)
    .set({
      status: PAUSED_STATUS,
      pausedAt: now,
      pausedUntil: verdict.until,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(subscriptions.id, input.subscriptionId),
        eq(subscriptions.shopId, input.shopId),
        isNull(subscriptions.pausedAt),
        ne(subscriptions.status, PAUSED_STATUS),
      ),
    )
    .returning({ id: subscriptions.id });

  if (!claimed) return { ok: false, verdict: { allowed: false, reason: "already_paused" } };
  return { ok: true, until: verdict.until };
}

/**
 * Lifts a freeze and moves the billing clock forward by the days spent frozen.
 *
 * The paid-for time is carried, not spent: a member who froze with eleven days
 * left has eleven days left when they come back. Anything else charges
 * somebody for a month they were told they would not be charged for.
 *
 * On the card rail Stripe pushes its own clock when `pause_collection` is
 * cleared, and the webhook writes the period end it reports — so the caller
 * passes `keepPeriodEnd` to leave that column alone rather than have Sailo and
 * Stripe both compute a date and disagree by a second.
 *
 * `pauseDaysUsed` is charged here, against the days actually spent frozen.
 */
export async function resumeMembership(input: {
  shopId: string;
  subscriptionId: string;
  keepPeriodEnd?: boolean;
  now?: Date;
}): Promise<boolean> {
  const db = getDb();
  const now = input.now ?? new Date();

  const row = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, input.subscriptionId),
      eq(subscriptions.shopId, input.shopId),
    ),
  });
  if (!row || !row.pausedAt) return false;

  const [claimed] = await db
    .update(subscriptions)
    .set({
      /*
       * Back to `active` rather than to whatever it was before.
       *
       * The only statuses a membership can be paused *from* are the open ones,
       * and every one of them means "the money is good right now" — which is
       * what `active` says. Restoring a remembered `past_due` would put a
       * member who paid in the middle of their freeze back into dunning.
       */
      status: "active",
      pausedAt: null,
      pausedUntil: null,
      pauseDaysUsed: sql`${subscriptions.pauseDaysUsed} + ${pausedDays(row.pausedAt, now)}`,
      ...(input.keepPeriodEnd
        ? {}
        : {
            currentPeriodEnd: periodEndAfterPause(row.currentPeriodEnd, row.pausedAt, now),
          }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(subscriptions.id, input.subscriptionId),
        eq(subscriptions.shopId, input.shopId),
        isNotNull(subscriptions.pausedAt),
      ),
    )
    .returning({ id: subscriptions.id });

  return Boolean(claimed);
}

/**
 * The sweep that lifts freezes whose time is up.
 *
 * A member who froze for a month must come back on their own, without the
 * seller remembering — and without a member having to log in to something they
 * have no account for. Fleet-wide, claimed one row at a time, so overlapping
 * ticks resume a member once.
 *
 * Card-rail rows are left to their own webhook: Stripe resumes collection and
 * reports the new period, and a sweep that moved the date first would be Sailo
 * disagreeing with the billing source of truth.
 */
export async function resumeDuePauses(now = new Date()): Promise<number> {
  const db = getDb();

  const due = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.billingMode, "manual"),
      isNotNull(subscriptions.pausedUntil),
      lte(subscriptions.pausedUntil, now),
    ),
    limit: 200,
  });

  let resumed = 0;
  for (const row of due) {
    if (await resumeMembership({ shopId: row.shopId, subscriptionId: row.id, now })) {
      resumed += 1;
    }
  }
  return resumed;
}

/* -------------------------------------------------------------------------- */
/*  Cancellation                                                              */
/* -------------------------------------------------------------------------- */

export type CancelResult =
  | { ok: true; verdict: CancelVerdict; immediate: boolean }
  | { ok: false; verdict: CancelVerdict }
  | { ok: false; verdict: null };

/**
 * Ends a membership, at the period end or immediately.
 *
 * **Immediate cancellation is a seller action with a money question.** It ends
 * access inside a period the member paid for, so the caller must say what
 * happens to that money: `refunded` records that they were given it back and
 * `false` records that they were not. Neither is a default this function
 * picks — a member who loses access mid-month with no refund and no record is
 * a chargeback with our own panel as the evidence against us.
 *
 * The refund itself is not issued here. Reversing a payment is `refundOrder`'s
 * job and it has its own claim, its own ledger row and its own Stripe call;
 * this records *which decision was made*, which is the half a dispute is
 * argued from five months later.
 */
export async function cancelMembership(input: {
  shopId: string;
  subscriptionId: string;
  immediate: boolean;
  /** True when the seller is also giving the money back. Recorded, not acted on. */
  refunded?: boolean;
  now?: Date;
}): Promise<CancelResult> {
  const db = getDb();
  const now = input.now ?? new Date();

  const row = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, input.subscriptionId),
      eq(subscriptions.shopId, input.shopId),
    ),
  });
  if (!row) return { ok: false, verdict: null };

  const product = row.productId
    ? await db.query.products.findFirst({
        where: eq(products.id, row.productId),
        columns: { minimumTermCycles: true, cancelNoticeDays: true },
      })
    : null;

  const verdict = cancelVerdict(
    row,
    {
      minimumTermCycles: product?.minimumTermCycles ?? null,
      cancelNoticeDays: product?.cancelNoticeDays ?? null,
    },
    now,
  );
  /*
   * A minimum term stops a *seller-side* cancellation being recorded as one
   * the member was entitled to make — it never stops a manual member simply
   * not paying, and the copy says so. An immediate cancellation by the seller
   * overrides it, because the seller is the party the term protects.
   */
  if (!verdict.allowed && !input.immediate) return { ok: false, verdict };

  const [claimed] = await db
    .update(subscriptions)
    .set(
      input.immediate
        ? {
            status: "canceled",
            canceledAt: now,
            /*
             * The period end is brought forward to *now*, which is what
             * "immediately" means to `membershipAccess` — it compares against
             * this column and nothing else. Leaving it in the future would be a
             * row that says cancelled while the door still opens.
             */
            currentPeriodEnd: now,
            cancelAtPeriodEnd: false,
            endedReason: input.refunded ? "canceled_refunded" : "canceled",
            updatedAt: new Date(),
          }
        : {
            cancelAtPeriodEnd: true,
            endedReason: "canceled",
            updatedAt: new Date(),
          },
    )
    .where(
      and(
        eq(subscriptions.id, input.subscriptionId),
        eq(subscriptions.shopId, input.shopId),
        ne(subscriptions.status, "canceled"),
      ),
    )
    .returning({ id: subscriptions.id });

  if (!claimed) return { ok: false, verdict };
  return { ok: true, verdict, immediate: input.immediate };
}

/* -------------------------------------------------------------------------- */
/*  Switching                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Schedules a move to another membership at the end of the current period.
 *
 * **At the period end by default, and that is the whole decision.** The
 * memberships notes list "plan switching" and "proration UI" as not built, and
 * the reason proration was not built is that every version of it means Sailo
 * computing a number a buyer will be charged. Switching at the period end
 * computes nothing: the current period runs out, the next one is raised
 * against the new product, and the member sees the price they agreed to.
 *
 * Immediate switching is offered only where Stripe's own proration produces
 * the amount — the caller does that against Stripe and then calls
 * `applyPendingSwitch` — never against a number from here.
 */
export async function scheduleSwitch(input: {
  shopId: string;
  subscriptionId: string;
  toProductId: string;
}): Promise<boolean> {
  const db = getDb();

  const row = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, input.subscriptionId),
      eq(subscriptions.shopId, input.shopId),
    ),
  });
  if (!row) return false;

  /*
   * Ownership on the *target* as well as the subscription. The product id
   * comes from a form, and a switch to another shop's membership would bill a
   * member for something this seller does not sell.
   */
  const target = await db.query.products.findFirst({
    where: and(
      eq(products.id, input.toProductId),
      eq(products.shopId, input.shopId),
      eq(products.kind, "membership"),
    ),
    columns: { id: true },
  });
  if (!target) return false;

  const [claimed] = await db
    .update(subscriptions)
    .set({
      pendingProductId: target.id,
      pendingEffectiveAt: row.currentPeriodEnd,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(subscriptions.id, input.subscriptionId),
        eq(subscriptions.shopId, input.shopId),
        ne(subscriptions.status, "canceled"),
      ),
    )
    .returning({ id: subscriptions.id });

  return Boolean(claimed);
}

/**
 * The sweep that applies scheduled switches once their period ends.
 *
 * The price moves with the product, because the member agreed to the new
 * product's price — which is the one case where re-pricing an existing
 * subscription is right rather than a seller silently raising rates.
 *
 * Claimed by clearing `pendingProductId` in the same statement that reads it,
 * so two ticks switch a member once.
 */
export async function applyDueSwitches(now = new Date()): Promise<number> {
  const db = getDb();

  const due = await db.query.subscriptions.findMany({
    where: and(
      isNotNull(subscriptions.pendingProductId),
      or(
        isNull(subscriptions.pendingEffectiveAt),
        lte(subscriptions.pendingEffectiveAt, now),
      ),
      ne(subscriptions.status, "canceled"),
    ),
    limit: 200,
  });

  let switched = 0;
  for (const row of due) {
    if (await applyPendingSwitch(row, now)) switched += 1;
  }
  return switched;
}

/** One scheduled switch, applied. Exported so an immediate switch reuses it. */
export async function applyPendingSwitch(
  row: Subscription,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  if (!row.pendingProductId) return false;

  const target = await db.query.products.findFirst({
    where: and(
      eq(products.id, row.pendingProductId),
      eq(products.shopId, row.shopId),
    ),
  });
  if (!target) {
    // The seller deleted the product they scheduled a move to. Clearing the
    // pointer is the only honest outcome: leaving it would retry for ever
    // against a row that is never coming back.
    await db
      .update(subscriptions)
      .set({ pendingProductId: null, pendingEffectiveAt: null, updatedAt: new Date() })
      .where(eq(subscriptions.id, row.id));
    return false;
  }

  const interval = intervalOf({ billingInterval: target.billingInterval });
  const [claimed] = await db
    .update(subscriptions)
    .set({
      productId: target.id,
      priceCents: target.priceCents,
      interval,
      intervalCount: target.billingIntervalCount ?? 1,
      currentPeriodEnd: nextPeriodEnd(
        row.currentPeriodEnd,
        interval,
        now,
        target.billingIntervalCount ?? 1,
      ),
      /*
       * The term travels with the product, and it restarts. A member moving
       * from a monthly membership onto a 12-cycle course has bought the course
       * — carrying the old count would have them finish it in one payment.
       */
      termCycles: target.termCycles,
      accessAfterTerm: target.accessAfterTerm,
      cyclesPaid: 0,
      pendingProductId: null,
      pendingEffectiveAt: null,
      // A fresh renewal question against the new period.
      renewalOrderedFor: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(subscriptions.id, row.id),
        // The claim: whoever clears the pointer does the work.
        eq(subscriptions.pendingProductId, row.pendingProductId),
      ),
    )
    .returning({ id: subscriptions.id });

  return Boolean(claimed);
}
