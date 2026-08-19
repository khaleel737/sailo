import "server-only";
import { and, asc, between, count, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { stripe } from "@sailo/payments";
import {
  accountEvents,
  disputes,
  orderMessages,
  orders,
  platformUsageDaily,
  policySnapshots,
  products,
  shops,
  user,
  visitDaily,
  type Dispute,
} from "@sailo/db/schema";
import {
  assemblePlatformEvidence,
  contestDecision,
  usageGapsIn,
  type ContestDecision,
  type PlatformHoldings,
  type UsageDay,
} from "@sailo/core/disputes";

/**
 * Reading Sailo's own subscription evidence out of the database. Spec 46.
 *
 * The decisions are all in `@sailo/core/disputes/platform.ts`, which is pure and
 * where every branch is reachable from a test. What is here is the part that has
 * to know that a seller's sign-in history lives in `account_events`, that
 * Sailo's own terms are the `policy_snapshots` rows with a null `shop_id`, and
 * that usage is an aggregate written nightly because the raw sources are on
 * three retention clocks.
 *
 * ## The one number this file must never invent
 *
 * A day the rollup did not run is **not** a day the seller did not use Sailo.
 * `usageGapsIn` labels the difference and the evidence prints the gaps as gaps —
 * a false zero submitted to an issuer argues Sailo's own case against it, which
 * is the platform-side form of the rule spec 45 states for sellers.
 */

/** How far back the evidence window reaches. A dispute can be 120 days old. */
const EVIDENCE_WINDOW_DAYS = 180;

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Everything held about the seller behind a platform charge.
 *
 * Returns null when the dispute has no shop on it. `record.ts` resolves
 * `disputes.shopId` from `shops.stripeCustomerId` via `shopIdFor`, so a platform
 * dispute normally has one — but a charge against the platform account that
 * matched nothing is still recorded, still counts on the platform's ratio, and
 * must not crash the desk.
 */
export async function platformHoldingsFor(
  dispute: Dispute,
): Promise<PlatformHoldings | null> {
  if (!dispute.shopId) return null;
  const db = getDb();

  const shop = await db.query.shops.findFirst({ where: eq(shops.id, dispute.shopId) });
  if (!shop) return null;

  const owner = await db.query.user.findFirst({
    where: eq(user.id, shop.userId),
    columns: { name: true, email: true },
  });

  const chargedAt = dispute.stripeCreatedAt;
  const from = new Date(chargedAt.getTime() - EVIDENCE_WINDOW_DAYS * 86_400_000);

  const [events, usageRows, terms] = await Promise.all([
    /*
     * The account's own history, newest first and capped. `account_events` is
     * kept 400 days and deliberately outside the analytics sweep, which is the
     * whole reason spec 44 added it: better-auth's `session` carries exactly
     * this evidence and then deletes it on expiry.
     */
    db
      .select()
      .from(accountEvents)
      .where(eq(accountEvents.userId, shop.userId))
      .orderBy(desc(accountEvents.at))
      .limit(500),

    db
      .select()
      .from(platformUsageDaily)
      .where(
        and(
          eq(platformUsageDaily.shopId, shop.id),
          between(platformUsageDaily.day, utcDay(from), utcDay(chargedAt)),
        ),
      )
      .orderBy(asc(platformUsageDaily.day)),

    /*
     * Sailo's own terms — `policy_snapshots` with a NULL shop id, snapshotted on
     * deploy by `snapshotPlatformPolicies`. The seller accepted *a version*, and
     * a link to a page that has since changed is no better as our evidence than
     * a seller's changed URL is as theirs.
     */
    db.query.policySnapshots.findFirst({
      where: and(isNull(policySnapshots.shopId), eq(policySnapshots.kind, "terms")),
      orderBy: [desc(policySnapshots.capturedAt)],
      columns: { body: true, capturedAt: true },
    }),
  ]);

  const signup = events.find((event) => event.kind === "signup");
  const accepted = events.find((event) => event.kind === "terms_accepted");
  const signins = events
    .filter((event) => event.kind === "signin")
    .map((event) => ({
      at: event.at,
      ip: event.ip,
      country: event.country,
      city: event.city,
    }));

  const usage: UsageDay[] = usageRows.map((row) => ({
    day: row.day,
    signins: row.signins,
    ordersProcessed: row.ordersProcessed,
    storefrontViews: row.storefrontViews,
    adminActions: row.adminActions,
  }));

  /*
   * The receipt for this charge, from the message log — and whether it bounced.
   * Disclosed either way: a bounced receipt explains why a cardholder says they
   * were never told, and hiding it is the overstatement that loses a case on the
   * one point it was hidden about.
   */
  const receipt = await latestSubscriptionReceipt(shop.id, chargedAt);

  return {
    accountEmail: owner?.email ?? null,
    accountName: owner?.name ?? null,
    shopHandle: shop.handle,
    shopName: shop.name,

    signupAt: signup?.at ?? null,
    signupIp: signup?.ip ?? null,
    signupUserAgent: signup?.userAgent ?? null,
    signupCountry: signup?.country ?? null,

    termsAcceptedAt: accepted?.at ?? null,
    termsText: terms?.body ?? null,
    termsCapturedAt: terms?.capturedAt ?? null,

    plan: shop.plan,
    subscriptionStatus: shop.subscriptionStatus,
    subscriptionInterval: shop.subscriptionInterval,
    currentPeriodEnd: shop.currentPeriodEnd,
    /*
     * When they asked it to stop, from the durable record rather than from the
     * boolean. `shops.cancelAtPeriodEnd` says whether it is set *now*; the first
     * decision question is whether it was set *before we billed*, which a
     * boolean cannot answer.
     */
    cancelAtPeriodEndSetAt:
      events.find(
        (event) =>
          event.kind === "plan_change" &&
          typeof event.detail === "object" &&
          event.detail !== null &&
          (event.detail as { cancelAtPeriodEnd?: unknown }).cancelAtPeriodEnd === true,
      )?.at ?? null,
    planChanges: events
      .filter((event) => event.kind === "plan_change")
      .map((event) => ({ at: event.at, detail: JSON.stringify(event.detail ?? {}) })),

    chargedAt,
    amountCents: dispute.amountCents,
    currency: dispute.currency,
    statementDescriptor: await platformStatementDescriptor(),
    receiptSentTo: receipt?.toAddress ?? null,
    receiptBounced: receipt?.status === "bounced" || receipt?.status === "complained",

    signins,
    usage,
    usageGaps: usageGapsIn(
      from,
      chargedAt,
      usageRows.map((row) => row.day),
    ),

    claimedCancelledAt: null,
    duplicateInvoiceId: null,
    /*
     * False unless somebody says otherwise on the desk.
     *
     * Deliberately not inferred. "We owed a refund and did not process it" is
     * the one fact here that makes contesting dishonest, and guessing it from
     * row shapes would either miss the case that matters or refuse a case that
     * should be argued. Staff answer it, and the desk asks.
     */
    refundOwedUnprocessed: false,
  };
}

/**
 * The descriptor Sailo's own charges are *meant* to carry.
 *
 * `SAILO` is recognisable; a legal entity name is not, and `unrecognized` (Visa
 * 10.4 / MC 4837) is the reason code that fixes for free. Spec 44 set one for
 * sellers; this is ours.
 *
 * **This is the intent, not the evidence.** It is what the deploy check compares
 * the live account against — never what the evidence quotes. See
 * `platformStatementDescriptor` for why those must be different values.
 */
export const PLATFORM_STATEMENT_DESCRIPTOR = "SAILO";

/** Boxed so a cached `null` — a real answer — is distinguishable from a cold cache. */
let descriptorCache: { value: string | null } | null = null;

/**
 * What Stripe says is actually on the platform account's statements.
 *
 * ─── WHY THIS IS NOT `PLATFORM_STATEMENT_DESCRIPTOR` ───────────────────────
 *
 * The evidence line reads *"The charge appeared on the statement as X"*. That is
 * a statement of fact made to an issuer, in Sailo's name, about what a
 * cardholder saw — and quoting a constant makes it a claim about our intentions
 * dressed as a claim about their bank statement.
 *
 * Measured 19 August 2026: a platform account's descriptor **cannot be set
 * through the API at all**. `accounts.update(ownId, …)` is refused outright —
 * *"You cannot use this method on your own account: you may only use it on
 * connected accounts"* — and stripe-node's own doc comment says to use the
 * Dashboard. So the constant and reality are not merely capable of drifting,
 * they drift by default: the sandbox this was measured against reads
 * `SAILO SANDBOX`, and quoting `SAILO` for it would have been false.
 *
 * Null on any failure, and the renderer already prints nothing for a null
 * descriptor. An absent line loses a weak point; a wrong one is a false claim to
 * a bank, which spec 45 ranks as worse than the gap.
 *
 * Cached for the lifetime of the process: it is a Dashboard setting changed by a
 * human perhaps once, and a dispute desk should not spend a Stripe round trip
 * per page load on it.
 */
export async function platformStatementDescriptor(): Promise<string | null> {
  if (descriptorCache) return descriptorCache.value;
  try {
    const account = await stripe().accounts.retrieveCurrent();
    const value = account.settings?.payments?.statement_descriptor ?? null;
    descriptorCache = { value };
    return value;
  } catch (error) {
    console.error("[sailo] could not read the platform statement descriptor", error);
    // Deliberately not cached. A bad minute at Stripe should not silence the
    // line for the rest of the process's life.
    return null;
  }
}

/** The receipt mail for this subscription charge, if one is on record. */
async function latestSubscriptionReceipt(shopId: string, before: Date) {
  const row = await getDb()
    .select({
      toAddress: orderMessages.toAddress,
      status: orderMessages.status,
      sentAt: orderMessages.sentAt,
    })
    .from(orderMessages)
    .where(
      and(
        eq(orderMessages.shopId, shopId),
        lt(orderMessages.sentAt, new Date(before.getTime() + 86_400_000)),
      ),
    )
    .orderBy(desc(orderMessages.sentAt))
    .limit(1);
  return row[0] ?? null;
}

/** The three questions, answered from the holdings. */
export function platformDecision(
  holdings: PlatformHoldings,
  opts: { isInquiry?: boolean } = {},
): ContestDecision {
  return contestDecision(holdings, opts);
}

/* -------------------------------------------------------------------------- */
/*  The rollup                                                                */
/* -------------------------------------------------------------------------- */

export type UsageRollupResult = { shops: number; days: number };

/**
 * Fold one day of platform usage, per shop.
 *
 * Written by the existing nightly rollup — the same run that folds visits —
 * because the sources it reads are the ones that get pruned, and an evidence
 * claim must not depend on a table that empties itself.
 *
 * Idempotent by (shop, day): re-running a day overwrites it rather than doubling
 * it, so a failed run is fixed by running again. `rolledUpAt` moves with the
 * write, which is what makes "this day was measured" distinguishable from "this
 * day is missing".
 */
export async function rollUpPlatformUsage(
  day: Date = new Date(Date.now() - 86_400_000),
): Promise<UsageRollupResult> {
  const db = getDb();

  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  const key = utcDay(start);

  /*
   * Only shops on a paid plan. A free shop's usage is not evidence for anything
   * — there is no subscription charge to dispute — and folding the whole fleet
   * nightly for rows nobody will ever read is the cost this table would
   * otherwise carry forever.
   */
  const paidOnly = and(sql`${shops.plan} <> 'free'`, isNull(shops.deletedAt));

  const paid = await db
    .select({ id: shops.id, userId: shops.userId })
    .from(shops)
    .where(paidOnly);

  if (paid.length === 0) return { shops: 0, days: 0 };

  /*
   * ─── FOUR AGGREGATES, NOT SIX PER SHOP ────────────────────────────────────
   *
   * The first draft of this ran six counts inside a loop over every paying shop.
   * It was correct and it does not scale: over the HTTP driver that is 6N round
   * trips for a job that runs nightly over the whole paying fleet, and it was
   * caught by its own scenario timing out at two minutes once the test database
   * had accumulated enough shops to look like a small production one. A nightly
   * job whose cost is linear in customers is a job that quietly stops finishing.
   *
   * So: group in the database, join to `shops` so the paid predicate is applied
   * there rather than by shipping a list of ids back, and let the four queries
   * run at once. `count(*) filter (…)` gets sign-ins and admin actions out of
   * one pass over `account_events` rather than two.
   *
   * The join is only safe because `shops_user_id_key` is unique: one shop per
   * user. If that ever becomes one-to-many, joining `account_events` to `shops`
   * on `user_id` starts multiplying event rows per shop and every sign-in count
   * silently doubles — count distinct, or filter with EXISTS, before relaxing
   * it.
   */
  const [eventRows, orderRows, productRows, viewRows] = await Promise.all([
    db
      .select({
        userId: accountEvents.userId,
        signins: sql<number>`count(*) filter (where ${accountEvents.kind} = 'signin')`,
        actions: count(),
      })
      .from(accountEvents)
      .innerJoin(shops, eq(shops.userId, accountEvents.userId))
      .where(and(paidOnly, gte(accountEvents.at, start), lt(accountEvents.at, end)))
      .groupBy(accountEvents.userId),
    db
      .select({ shopId: orders.shopId, n: count() })
      .from(orders)
      .innerJoin(shops, eq(shops.id, orders.shopId))
      .where(and(paidOnly, gte(orders.createdAt, start), lt(orders.createdAt, end)))
      .groupBy(orders.shopId),
    db
      .select({ shopId: products.shopId, n: count() })
      .from(products)
      .innerJoin(shops, eq(shops.id, products.shopId))
      .where(and(paidOnly, eq(products.isPublished, true)))
      .groupBy(products.shopId),
    db
      .select({
        shopId: visitDaily.shopId,
        n: sql<string>`coalesce(sum(${visitDaily.visits}), 0)`,
      })
      .from(visitDaily)
      .innerJoin(shops, eq(shops.id, visitDaily.shopId))
      .where(and(paidOnly, eq(visitDaily.day, start)))
      .groupBy(visitDaily.shopId),
  ]);

  const signinsBy = new Map(eventRows.map((row) => [row.userId, Number(row.signins)]));
  const actionsBy = new Map(eventRows.map((row) => [row.userId, Number(row.actions)]));
  const ordersBy = new Map(orderRows.map((row) => [row.shopId, Number(row.n)]));
  const productsBy = new Map(productRows.map((row) => [row.shopId, Number(row.n)]));
  const viewsBy = new Map(viewRows.map((row) => [row.shopId, Number(row.n)]));

  /*
   * A shop absent from an aggregate had no rows that day, which is a real zero —
   * unlike a day the rollup never ran, which `usageGapsIn` reads off the missing
   * `platform_usage_daily` row. That distinction is the whole reason this table
   * exists, so every paying shop gets a row even when every count is zero.
   */
  const rolledUpAt = new Date();
  const rows = paid.map((shop) => ({
    shopId: shop.id,
    day: key,
    signins: signinsBy.get(shop.userId) ?? 0,
    ordersProcessed: ordersBy.get(shop.id) ?? 0,
    productsActive: productsBy.get(shop.id) ?? 0,
    emailsSent: 0,
    storefrontViews: viewsBy.get(shop.id) ?? 0,
    adminActions: actionsBy.get(shop.userId) ?? 0,
    rolledUpAt,
  }));

  /*
   * Chunked: one statement per 500 shops, because a single insert carrying the
   * whole fleet is a parameter count Postgres will refuse long before the fleet
   * is large enough to matter. Re-running overwrites rather than doubling, so a
   * failed run is fixed by running again — the same contract the loop had.
   */
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await db
      .insert(platformUsageDaily)
      .values(chunk)
      .onConflictDoUpdate({
        target: [platformUsageDaily.shopId, platformUsageDaily.day],
        set: {
          signins: sql`excluded.signins`,
          ordersProcessed: sql`excluded.orders_processed`,
          productsActive: sql`excluded.products_active`,
          storefrontViews: sql`excluded.storefront_views`,
          adminActions: sql`excluded.admin_actions`,
          rolledUpAt: sql`excluded.rolled_up_at`,
        },
      });
    written += chunk.length;
  }

  return { shops: paid.length, days: written };
}

/* -------------------------------------------------------------------------- */
/*  Telling staff, once                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Claim the "a platform dispute arrived" notification.
 *
 * The same conditional-update claim the seller notifications use, on its own
 * columns. Stripe delivers at least once and out of order, and one dispute
 * legitimately arrives under five event ids — without the claim a retried
 * `charge.dispute.created` pages the desk five times, which is the shape of bug
 * that makes people mute the channel.
 *
 * Returns true only for the caller that won.
 */
export async function claimStaffNotice(
  disputeId: string,
  kind: "opened" | "deadline",
): Promise<boolean> {
  const column =
    kind === "opened" ? disputes.staffNotifiedAt : disputes.staffDeadlineNotifiedAt;

  const [claimed] = await getDb()
    .update(disputes)
    .set(kind === "opened" ? { staffNotifiedAt: new Date() } : { staffDeadlineNotifiedAt: new Date() })
    .where(and(eq(disputes.id, disputeId), isNull(column)))
    .returning({ id: disputes.id });

  return Boolean(claimed);
}

/* -------------------------------------------------------------------------- */
/*  Repeat offenders                                                          */
/* -------------------------------------------------------------------------- */

/** How many platform chargebacks close the card rail to a customer. */
export const PLATFORM_CHARGEBACK_LIMIT = 2;

/**
 * Whether this shop may still pay Sailo by card, and close the rail if not.
 *
 * A second platform chargeback from one customer is not an accident. The control
 * is deliberately narrow — the shop keeps trading, keeps taking card payments
 * from its own buyers, keeps its storefront; all that closes is the rail it pays
 * *us* on, and nothing else is offered in its place.
 *
 * Inquiries are excluded. No money has moved on one, and counting it would close
 * a seller's billing over a question their bank asked.
 */
export async function enforceCardBillingBlock(shopId: string): Promise<boolean> {
  const db = getDb();

  const [row] = await db
    .select({ n: count() })
    .from(disputes)
    .where(
      and(
        eq(disputes.shopId, shopId),
        eq(disputes.scope, "platform"),
        sql`${disputes.caseType} is distinct from 'inquiry'`,
      ),
    );

  const chargebacks = row?.n ?? 0;
  if (chargebacks < PLATFORM_CHARGEBACK_LIMIT) return false;

  await db
    .update(shops)
    .set({
      cardBillingBlockedAt: new Date(),
      cardBillingBlockedReason: `${chargebacks} platform chargebacks`,
      updatedAt: new Date(),
    })
    .where(and(eq(shops.id, shopId), isNull(shops.cardBillingBlockedAt)))
    .returning({ id: shops.id });

  return true;
}

/**
 * Hold the downgrade while the case is open, and restore the plan on a win.
 *
 * The existing downgrade on a *lost* platform dispute is correct and keeps
 * working. What this adds is that contesting and downgrading are not exclusive:
 * the plan is remembered when the dispute opens, and a `fundsReinstatedAt` puts
 * it back. Without `planBeforeDispute` a win would restore whatever the code
 * guessed rather than what the seller was paying for.
 */
export async function holdPlanForDispute(shopId: string): Promise<void> {
  const db = getDb();
  const shop = await db.query.shops.findFirst({
    where: eq(shops.id, shopId),
    columns: { plan: true, planBeforeDispute: true },
  });
  if (!shop || shop.planBeforeDispute) return;

  await db
    .update(shops)
    .set({ planBeforeDispute: shop.plan })
    // Claimed: two deliveries of `charge.dispute.created` must not overwrite the
    // remembered plan with one that a downgrade has already changed.
    .where(and(eq(shops.id, shopId), isNull(shops.planBeforeDispute)))
    .returning({ id: shops.id });
}

/** Put the plan back after a win, and forget the hold. */
export async function reinstatePlanAfterWin(shopId: string): Promise<boolean> {
  const db = getDb();
  const shop = await db.query.shops.findFirst({
    where: eq(shops.id, shopId),
    columns: { planBeforeDispute: true },
  });
  if (!shop?.planBeforeDispute) return false;

  await db
    .update(shops)
    .set({ plan: shop.planBeforeDispute, planBeforeDispute: null, updatedAt: new Date() })
    .where(eq(shops.id, shopId));

  return true;
}

/* -------------------------------------------------------------------------- */
/*  Answering one                                                             */
/* -------------------------------------------------------------------------- */

export type PlatformRespondResult =
  | { ok: true; completenessBp: number; refundInstead: false }
  /**
   * Refused *because the seller is right*, which is a first-class outcome and
   * not an absence of one.
   *
   * "If the seller is right, refund" is the rule spec 46 says matters most. A
   * subscription dispute is often a cancellation that did not work or a trial
   * that converted without notice — our bugs — and contesting one is dishonest
   * as well as a loss: we spend the fee, lose anyway, and add a loss to the
   * platform account's own rate. So the desk offers no submit button, and this
   * path refuses even if somebody posts the form anyway.
   */
  | { ok: false; refundInstead: true; error: string }
  | { ok: false; refundInstead?: false; error: string };

/**
 * Submit Sailo's own evidence on a platform dispute.
 *
 * Separate from `respondToDispute` rather than a branch inside it, and the
 * reason is the same one that keeps `assemble.ts` free of a platform branch:
 * that function opens by requiring an order and refusing without one, which is
 * correct for every connected case and is the whole shape of this one. Two
 * functions with two holdings types, each testable on its own.
 *
 * No CE3.0 attempt here. `ce3.ts` needs a platform-side identity mapper and
 * `platformCe3Identity` provides it — but Visa's rule wants two *prior
 * undisputed transactions* resolved to settled charge ids, which on this side
 * means walking Stripe's subscription invoices. That is a real piece of work and
 * doing it badly is worse than not doing it.
 *
 * Measured against the live API on 19 August 2026 rather than assumed: an
 * `enhanced_evidence.visa_compelling_evidence_3` payload on an ineligible charge
 * is refused — *"Disputed transaction … is not eligible for Visa Compelling
 * Evidence 3.0"* — and the `product_description` and `uncategorized_text` sent
 * in the same `disputes.update` were **both still null afterwards**. One
 * speculative enhanced payload costs the entire answer. `docs/chargebacks.md`
 * §11.
 */
export async function respondToPlatformDispute(opts: {
  disputeId: string;
  submit: boolean;
  /** Staff's answer to "did we owe a refund and not process it?". */
  refundOwedUnprocessed?: boolean;
  now?: Date;
}): Promise<PlatformRespondResult> {
  const db = getDb();

  const row = await db.query.disputes.findFirst({
    where: eq(disputes.id, opts.disputeId),
  });
  if (!row) return { ok: false, error: "Dispute not found." };
  if (row.scope !== "platform") {
    return {
      ok: false,
      error: "That is a connected-account dispute — answer it from the seller's evidence.",
    };
  }

  const holdings = await platformHoldingsFor(row);
  if (!holdings) {
    return {
      ok: false,
      error:
        "This platform charge matched no Sailo account, so there is nothing to assemble. " +
        "Answer it from the Stripe dashboard, or refund it.",
    };
  }

  const withAnswer: PlatformHoldings = {
    ...holdings,
    refundOwedUnprocessed: opts.refundOwedUnprocessed ?? false,
  };

  const decision = contestDecision(withAnswer, { isInquiry: row.caseType === "inquiry" });
  if (decision.verdict === "refund") {
    return { ok: false, refundInstead: true, error: decision.headline };
  }

  const evidence = assemblePlatformEvidence(row.reason, withAnswer);

  const result = await submitPlatformEvidence({
    disputeId: row.stripeDisputeId,
    payload: evidence.payload,
    submit: opts.submit,
  });
  if (!result.ok) return { ok: false, error: result.error };

  await db
    .update(disputes)
    .set({
      ...(opts.submit
        ? {
            evidenceSubmittedAt: opts.now ?? new Date(),
            submissionCount: sql`${disputes.submissionCount} + 1`,
          }
        : {}),
      /*
       * The snapshot, as sent. Same reasoning `disputes.evidenceSnapshot`
       * already gives: three months later, when the case is lost and somebody
       * asks what we actually claimed, re-assembling from live holdings answers
       * a different question — the usage aggregate has moved on and the terms
       * may have been re-snapshotted.
       */
      evidenceSnapshot: {
        scope: "platform",
        payload: evidence.payload,
        decision: decision.verdict,
        questions: decision.questions,
      },
      completenessBp: evidence.completenessBp,
      updatedAt: new Date(),
    })
    .where(eq(disputes.id, row.id));

  return { ok: true, completenessBp: evidence.completenessBp, refundInstead: false };
}

/**
 * The Stripe call, on the platform account — no `stripeAccount` header.
 *
 * That absence is the whole difference from the connected path and it is easy to
 * get wrong in the direction that fails silently: a `disputes.update` sent with
 * a connected account header for a platform dispute is a 404 on somebody else's
 * account, and a submission that 404s is a case answered with nothing.
 */
async function submitPlatformEvidence(opts: {
  disputeId: string;
  payload: Record<string, string>;
  submit: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { stripe } = await import("@sailo/payments");
    await stripe().disputes.update(opts.disputeId, {
      evidence: opts.payload,
      submit: opts.submit,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Stripe rejected the submission.",
    };
  }
}
