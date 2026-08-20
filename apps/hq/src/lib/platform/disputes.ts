import "server-only";
import { and, asc, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getReadDb } from "@sailo/db";
import { disputes, earlyFraudWarnings, orders, shops, user } from "@sailo/db/schema";
import { requireStaff } from "@/lib/session";
import {
  NETWORK_PROGRAMMES,
  SAILO_THRESHOLDS,
  daysToRespond,
  disputeOutcome,
  isInquiry,
  needsResponse,
  playbookFor,
  ratioBp,
  assemblePlatformEvidence,
} from "@sailo/core/disputes";
import {
  disputeReadiness,
  evidenceBudget,
  evidenceCoverage,
  evidenceFilesFor,
  platformDecision,
  platformDisputeMonths,
  platformHoldingsFor,
} from "@sailo/commerce/disputes";

/**
 * What HQ needs to answer a chargeback and to spot the shop producing them.
 *
 * Two questions with two shapes, and keeping them apart is the point:
 *
 *   **The queue.** Every dispute still owing a response, soonest deadline first,
 *   with enough on each row to decide whether to fight it or refund it. Sorted by
 *   `dueBy` because a deadline is the only thing here that cannot be recovered —
 *   evidence submitted a minute late is not submitted, and Stripe closes the
 *   window server-side with no override.
 *
 *   **The exposure.** Which shops are producing them, measured against the
 *   orders the disputes came from rather than against this month's volume, and
 *   how much money Sailo would cover if those shops' balances cannot.
 */

export type DisputeQueueRow = {
  id: string;
  stripeDisputeId: string;
  scope: string;
  shopId: string | null;
  shopName: string | null;
  shopHandle: string | null;
  ownerId: string | null;
  orderId: string | null;
  amountCents: number;
  deductedCents: number;
  currency: string;
  reason: string;
  reasonLabel: string;
  networkReasonCode: string | null;
  caseType: string | null;
  status: string;
  outcome: string;
  inquiry: boolean;
  dueBy: Date | null;
  daysLeft: number | null;
  submittedAt: Date | null;
  completenessBp: number | null;
  ce3Status: string | null;
  createdAt: Date;
  /** What actually decides this reason, for the row's one-line hint. */
  guidance: string;
};

/**
 * How many of the queue a screen shows before it stops.
 *
 * The query fetches 200 and the page rendered every one of them, which on a
 * platform with a real backlog produced a 23,633-pixel page — a hundred and
 * fifty rows below the fold that nobody scrolls to, on a list already sorted so
 * that the only ones worth reading are at the top.
 *
 * `total` comes back beside the rows so the page can say what it is not
 * showing. A cap that is not stated is the same bug wearing a tidier layout.
 */
export const DISPUTE_QUEUE_PAGE = 25;

/**
 * The response queue.
 *
 * `needsResponse` only, by default: a dispute under review has nothing anybody
 * can do about it, and a queue that lists them is a queue people stop reading.
 *
 * `limit` is the *render* cap, separate from the 200-row fetch: the fetch bounds
 * the query and this bounds the page. `all: true` lifts the status filter, not
 * the cap.
 */
export async function getDisputeQueue(opts: { all?: boolean; limit?: number } = {}) {
  await requireStaff();
  const db = getReadDb();
  const now = new Date();

  const rows = await db
    .select({
      dispute: disputes,
      shopName: shops.name,
      shopHandle: shops.handle,
      ownerId: shops.userId,
    })
    .from(disputes)
    .leftJoin(shops, eq(shops.id, disputes.shopId))
    .where(
      opts.all
        ? undefined
        : sql`${disputes.status} in ('needs_response', 'warning_needs_response')`,
    )
    /*
     * Deadline first, nulls last. A dispute Stripe gave no `due_by` for is one
     * nobody can miss a date on, so it must not sit above one that expires
     * tomorrow — which is what a plain ascending sort does with nulls in
     * Postgres.
     */
    .orderBy(sql`${disputes.dueBy} asc nulls last`, desc(disputes.stripeCreatedAt))
    .limit(200);

  const shown = opts.limit ? rows.slice(0, opts.limit) : rows;

  const mapped = shown.map(({ dispute, shopName, shopHandle, ownerId }): DisputeQueueRow => {
    const playbook = playbookFor(dispute.reason);
    return {
      id: dispute.id,
      stripeDisputeId: dispute.stripeDisputeId,
      scope: dispute.scope,
      shopId: dispute.shopId,
      shopName,
      shopHandle,
      ownerId,
      orderId: dispute.orderId,
      amountCents: dispute.amountCents,
      deductedCents: dispute.deductedCents,
      currency: dispute.currency,
      reason: dispute.reason,
      reasonLabel: playbook.label,
      networkReasonCode: dispute.networkReasonCode,
      caseType: dispute.caseType,
      status: dispute.status,
      outcome: disputeOutcome(dispute.status),
      inquiry: isInquiry(dispute.status),
      dueBy: dispute.dueBy,
      daysLeft: daysToRespond({ status: dispute.status, dueBy: dispute.dueBy }, now),
      submittedAt: dispute.evidenceSubmittedAt,
      completenessBp: dispute.completenessBp,
      ce3Status: dispute.ce3Status,
      createdAt: dispute.stripeCreatedAt,
      guidance: playbook.guidance,
    };
  });

  /*
   * The rows and what they are a slice of, together. The page needs both to be
   * able to say "the 25 most urgent of 148" — and returning only the rows is
   * how a cap becomes silent.
   */
  return { rows: mapped, total: rows.length, capped: rows.length > shown.length };
}

export type ShopExposureRow = {
  shopId: string;
  handle: string;
  name: string;
  ownerId: string;
  ownerEmail: string | null;
  chargebacks: number;
  inquiries: number;
  /** Only counting orders Sailo saw; null below the floor. */
  chargebackBp: number | null;
  settledOrders: number;
  openDisputeCents: number;
  awaitingResponse: number;
  payoutsPausedAt: Date | null;
  payoutsPausedReason: string | null;
  suspendedAt: Date | null;
  disputeClearedAt: Date | null;
};

/**
 * Shops with any dispute at all, worst exposure first.
 *
 * One query rather than `shopDisputeStats` per shop: that function is the honest
 * per-shop measurement and it runs a cohort query plus a Stripe balance read,
 * which is right for a decision about one shop and wrong for a list of forty.
 * So this is the *screen* — it says which shops to look at — and the shop's own
 * page runs the real thing.
 *
 * The rate here is deliberately the crude one, over all settled orders rather
 * than pooled over mature cohorts, and the column is labelled as such in the UI.
 * A screening list may be approximate; the number that holds a payout may not.
 */
export async function getShopExposure() {
  await requireStaff();
  const db = getReadDb();

  const rows = await db
    .select({
      shopId: shops.id,
      handle: shops.handle,
      name: shops.name,
      ownerId: shops.userId,
      ownerEmail: user.email,
      payoutsPausedAt: shops.payoutsPausedAt,
      payoutsPausedReason: shops.payoutsPausedReason,
      suspendedAt: shops.suspendedAt,
      disputeClearedAt: shops.disputeClearedAt,
      chargebacks: sql<string>`count(case when ${disputes.status} not like 'warning\\_%' then 1 end)`,
      inquiries: sql<string>`count(case when ${disputes.status} like 'warning\\_%' then 1 end)`,
      awaitingResponse: sql<string>`count(case when ${disputes.status} in ('needs_response', 'warning_needs_response') then 1 end)`,
      openDisputeCents: sql<string>`coalesce(sum(case when ${disputes.status} in ('needs_response', 'under_review') and ${disputes.fundsWithdrawnAt} is not null then ${disputes.deductedCents} end), 0)`,
      settledOrders: sql<string>`(
        select count(*) from ${orders}
        where ${orders.shopId} = ${shops.id}
          and ${orders.paymentStatus} in ('paid', 'refunded', 'disputed')
          and (${orders.stripePaymentIntentId} is not null or ${orders.stripeInvoiceId} is not null)
      )`,
    })
    .from(disputes)
    .innerJoin(shops, eq(shops.id, disputes.shopId))
    .innerJoin(user, eq(user.id, shops.userId))
    .where(eq(disputes.scope, "connected"))
    .groupBy(shops.id, user.email)
    .orderBy(desc(sql`count(*)`))
    .limit(100);

  return rows
    .map((row): ShopExposureRow => {
      const chargebacks = Number(row.chargebacks);
      const settledOrders = Number(row.settledOrders);
      return {
        shopId: row.shopId,
        handle: row.handle,
        name: row.name,
        ownerId: row.ownerId,
        ownerEmail: row.ownerEmail,
        chargebacks,
        inquiries: Number(row.inquiries),
        settledOrders,
        /*
         * The same two-sided floor the decision uses, so a screening list cannot
         * put a shop with one dispute on three orders at the top on 33%.
         */
        chargebackBp:
          chargebacks >= 2 && settledOrders >= 25
            ? ratioBp(chargebacks, settledOrders)
            : null,
        openDisputeCents: Number(row.openDisputeCents),
        awaitingResponse: Number(row.awaitingResponse),
        payoutsPausedAt: row.payoutsPausedAt,
        payoutsPausedReason: row.payoutsPausedReason,
        suspendedAt: row.suspendedAt,
        disputeClearedAt: row.disputeClearedAt,
      };
    })
    .sort(
      (a, b) =>
        b.openDisputeCents - a.openDisputeCents ||
        (b.chargebackBp ?? 0) - (a.chargebackBp ?? 0),
    );
}

/**
 * The platform's own numbers, and the two things they are measured against.
 *
 * The month-of-arrival ratio here is the one Visa and Mastercard actually
 * compute, and it is the *only* place in this codebase where an arrival-month
 * count is the right answer — see `stats.ts`. It answers "are we about to be
 * fined", which is a different question from "is this seller a problem", and
 * mixing the two is the mistake the whole rate module is written around.
 */
export async function getPlatformDisputeHealth() {
  await requireStaff();
  const db = getReadDb();
  const now = new Date();

  const [months, coverage, openRow, efwRow] = await Promise.all([
    platformDisputeMonths(6, now),
    evidenceCoverage(now),
    db
      .select({
        open: sql<string>`count(case when ${disputes.status} in ('needs_response', 'under_review') then 1 end)`,
        awaiting: sql<string>`count(case when ${disputes.status} in ('needs_response', 'warning_needs_response') then 1 end)`,
        pastDue: sql<string>`count(case when ${disputes.status} in ('needs_response', 'warning_needs_response') and ${disputes.dueBy} < now() then 1 end)`,
        openCents: sql<string>`coalesce(sum(case when ${disputes.status} in ('needs_response', 'under_review') then ${disputes.deductedCents} end), 0)`,
        lostCents: sql<string>`coalesce(sum(case when ${disputes.status} = 'lost' then ${disputes.deductedCents} end), 0)`,
        won: sql<string>`count(case when ${disputes.status} = 'won' then 1 end)`,
        lost: sql<string>`count(case when ${disputes.status} = 'lost' then 1 end)`,
        /*
         * Submitted evidence, which is the only measure of whether the pipeline
         * is used at all. A platform whose disputes are answered on zero of them
         * has a feature nobody found.
         */
        answered: sql<string>`count(case when ${disputes.evidenceSubmittedAt} is not null then 1 end)`,
        total: sql<string>`count(*)`,
      })
      .from(disputes),
    db
      .select({
        warnings: sql<string>`count(*)`,
        becameDisputes: sql<string>`count(case when ${earlyFraudWarnings.disputeId} is not null then 1 end)`,
        refunded: sql<string>`count(case when ${earlyFraudWarnings.refundedAt} is not null then 1 end)`,
      })
      .from(earlyFraudWarnings)
      .where(gte(earlyFraudWarnings.stripeCreatedAt, new Date(now.getTime() - 90 * 86_400_000))),
  ]);

  const open = openRow[0];
  const efw = efwRow[0];
  const won = Number(open?.won ?? 0);
  const lost = Number(open?.lost ?? 0);

  return {
    months: months.map((month) => ({
      ...month,
      /* The network view: disputes raised this month over this month's volume. */
      arrivalBp: ratioBp(month.chargebacks, month.settledOrders),
    })),
    thresholds: NETWORK_PROGRAMMES,
    sailoThresholds: SAILO_THRESHOLDS,
    open: Number(open?.open ?? 0),
    awaiting: Number(open?.awaiting ?? 0),
    pastDue: Number(open?.pastDue ?? 0),
    openCents: Number(open?.openCents ?? 0),
    lostCents: Number(open?.lostCents ?? 0),
    won,
    lost,
    winRateBp: won + lost > 0 ? ratioBp(won, won + lost) : null,
    answered: Number(open?.answered ?? 0),
    total: Number(open?.total ?? 0),
    coverage,
    warnings: {
      total: Number(efw?.warnings ?? 0),
      becameDisputes: Number(efw?.becameDisputes ?? 0),
      refunded: Number(efw?.refunded ?? 0),
    },
  };
}

/** Every dispute for one shop, for the account page. */
export async function getShopDisputes(shopId: string) {
  await requireStaff();
  const now = new Date();

  const rows = await getReadDb()
    .select()
    .from(disputes)
    .where(eq(disputes.shopId, shopId))
    .orderBy(sql`${disputes.dueBy} asc nulls last`, desc(disputes.stripeCreatedAt))
    .limit(100);

  return rows.map((dispute) => ({
    ...dispute,
    outcome: disputeOutcome(dispute.status),
    inquiry: isInquiry(dispute.status),
    open: needsResponse(dispute.status),
    daysLeft: daysToRespond({ status: dispute.status, dueBy: dispute.dueBy }, now),
    reasonLabel: playbookFor(dispute.reason).label,
  }));
}

/**
 * The orders behind a shop's open disputes, so a row can link to one.
 *
 * Separate from the dispute rows because a dispute frequently has no order —
 * a subscription chargeback, or a charge taken outside Sailo — and joining
 * would drop exactly the rows that most need looking at.
 */
export async function getDisputeOrders(disputeIds: readonly string[]) {
  if (disputeIds.length === 0) return new Map<string, { id: string; title: string }>();
  await requireStaff();

  const rows = await getReadDb()
    .select({
      disputeId: disputes.id,
      orderId: orders.id,
      title: orders.productTitle,
    })
    .from(disputes)
    .innerJoin(orders, eq(orders.id, disputes.orderId))
    .where(
      and(
        isNotNull(disputes.orderId),
        sql`${disputes.id} in ${disputeIds}`,
      ),
    );

  return new Map(rows.map((row) => [row.disputeId, { id: row.orderId, title: row.title }]));
}

/** Warnings that have not become disputes — still refundable, still worth acting on. */
export async function getOpenFraudWarnings() {
  await requireStaff();

  return getReadDb()
    .select({
      warning: earlyFraudWarnings,
      shopHandle: shops.handle,
      shopName: shops.name,
    })
    .from(earlyFraudWarnings)
    .leftJoin(shops, eq(shops.id, earlyFraudWarnings.shopId))
    .where(sql`${earlyFraudWarnings.disputeId} is null and ${earlyFraudWarnings.refundedAt} is null`)
    .orderBy(asc(earlyFraudWarnings.stripeCreatedAt))
    .limit(50);
}

/**
 * One dispute, with everything needed to decide what to send.
 *
 * The read behind `/disputes/[id]`, and the answer to the question the queue
 * cannot answer: *what exactly would be submitted if I pressed Send?* The queue
 * shows a completeness percentage, which is enough to triage and not enough to
 * act — a case at 80% might be missing a persuasive extra or the one document
 * the network decides on, and those are not the same afternoon.
 *
 * `disputeReadiness` does the assembling and reaches Stripe for the live status;
 * everything else here is the surrounding context a human needs on the page —
 * whose shop, which order, what has already been attached.
 */
export async function getDisputeDetail(id: string) {
  await requireStaff();
  const db = getReadDb();

  const dispute = await db.query.disputes.findFirst({ where: eq(disputes.id, id) });
  if (!dispute) return null;

  const [shop, order, files, readiness] = await Promise.all([
    dispute.shopId
      ? db.query.shops.findFirst({ where: eq(shops.id, dispute.shopId) })
      : Promise.resolve(undefined),
    dispute.orderId
      ? db.query.orders.findFirst({ where: eq(orders.id, dispute.orderId) })
      : Promise.resolve(undefined),
    evidenceFilesFor(id),
    /*
     * Reaches Stripe, and is allowed to fail. A dispute whose account is
     * unreachable still has a deadline, an amount and a shop, and a page that
     * 500s because Stripe is slow is a page that is down at exactly the moment
     * somebody needed the deadline.
     *
     * Skipped entirely for a platform dispute. `assembleEvidence` opens by
     * requiring an order and there is none — and the Stripe read it makes would
     * go out with a connected-account header that names nobody. Spec 46's own
     * holdings are gathered below instead.
     */
    dispute.scope === "platform"
      ? Promise.resolve(null)
      : disputeReadiness(id).catch(() => null),
  ]);

  const owner = shop
    ? await db.query.user.findFirst({
        where: eq(user.id, shop.userId),
        columns: { id: true, email: true, name: true },
      })
    : undefined;

  /*
   * Spec 46 — the platform side.
   *
   * A `platform` dispute is a seller charging back their own Sailo
   * subscription: Sailo is the merchant of record, there is no order and no
   * connected account, and `disputeReadiness` above resolves nothing because
   * every field resolver in `assemble.ts` reads an order. So this branch gathers
   * the other holdings — signup, terms acceptance, sign-in history, real usage —
   * and answers the three questions that decide whether to fight at all.
   *
   * Loaded only for the scope that needs it. A connected dispute pays nothing
   * for this existing.
   */
  const platform =
    dispute.scope === "platform" ? await platformHoldingsFor(dispute) : null;

  return {
    dispute,
    shop: shop ?? null,
    owner: owner ?? null,
    order: order ?? null,
    files,
    budget: evidenceBudget(files),
    readiness,
    platform: platform
      ? {
          holdings: platform,
          evidence: assemblePlatformEvidence(dispute.reason, platform),
          decision: platformDecision(platform, { isInquiry: isInquiry(dispute.status) }),
        }
      : null,
  };
}
