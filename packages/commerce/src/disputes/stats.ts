import "server-only";
import { and, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { disputes, orders } from "@sailo/db/schema";
import {
  DISPUTE_LAG_DAYS,
  EMPTY_TALLY,
  emergingRisk,
  pooledRate,
  rateCohort,
  type Cohort,
  type CohortRate,
  type DisputeTally,
} from "@sailo/core/disputes";

/**
 * A shop's dispute rate, measured against the orders the disputes came from.
 *
 * The SQL here is the whole trap. The obvious query —
 *
 *     select count(*) from disputes
 *     where shop_id = $1 and created_at >= date_trunc('month', now())
 *
 * — reads fast, looks right and answers a question nobody asked. Disputes arrive
 * 60–120 days after the sale, so that numerator belongs to a much smaller
 * denominator than the current month's order count. A seller running genuine 6%
 * fraud while tripling volume each month reports 0.22%: their May disputes
 * divided by their August orders. The faster they grow, the cleaner they look,
 * and growth is what a fraud ring does.
 *
 * So every count below joins from the **order** and groups by the order's
 * creation month. `disputes.stripe_created_at` is used for the queue and for the
 * deadline, and never for a rate.
 */

/** Months of history to measure over. */
const COHORT_MONTHS = 12;

/**
 * Which orders can be charged back, and therefore what the denominator is.
 *
 * Only orders that went through Stripe. A shop taking 900 cash-on-delivery
 * orders and 100 card orders with three chargebacks has a 3% card dispute rate,
 * and counting the cash in the denominator reports 0.3% — a tenth of the truth,
 * on the shops most likely to be selling into cash markets. Visa counts card
 * transactions; so does this.
 *
 * Keyed on the Stripe identifiers rather than on `paymentMethod = 'card'`,
 * because the identifier is the thing that makes a chargeback possible. Both
 * columns are needed: a one-off sale carries a payment intent, a membership
 * renewal carries only an invoice id.
 */
const chargeable = () =>
  or(isNotNull(orders.stripePaymentIntentId), isNotNull(orders.stripeInvoiceId));

/**
 * Orders that actually took money.
 *
 * `unpaid` is an abandoned checkout — a third of card sessions — and counting
 * those in the denominator understates every rate by roughly a third.
 * `disputed` and `refunded` are counted: money arrived and then left, which is
 * exactly the population a chargeback can come from.
 */
const settled = () =>
  sql`${orders.paymentStatus} in ('paid', 'refunded', 'disputed')`;

type CohortRow = {
  cohort: Date;
  settledOrders: number;
  chargebacks: number;
  fraudChargebacks: number;
  inquiries: number;
  won: number;
  lost: number;
};

/**
 * One row per month, disputes attributed to the order's month.
 *
 * A `left join` from orders, not a join from disputes, and the direction is
 * load-bearing: a month with orders and no disputes has to appear with a zero,
 * or the denominator silently drops out of the pooled rate and every shop reads
 * as worse than it is.
 *
 * The dispute-side filters live in the join's `on` clause rather than in `where`,
 * for the same reason. In `where` they would discard whole order rows whose
 * disputes did not match, turning the outer join into an inner one.
 */
async function cohortRows(shopId: string, since: Date): Promise<CohortRow[]> {
  const db = getDb();

  const month = sql<Date>`date_trunc('month', ${orders.createdAt})`;

  /*
   * `warning_%` is the inquiry test, matching `isInquiry`. Neither Visa's VAMP
   * nor Mastercard's MMP counts a retrieval request, so a rate that does is not
   * the rate we are measured on — and counting them roughly doubles it.
   */
  const isChargeback = sql`${disputes.status} not like 'warning\\_%'`;

  const rows = await db
    .select({
      cohort: month,
      settledOrders: sql<string>`count(distinct ${orders.id})`,
      chargebacks: sql<string>`count(distinct case when ${isChargeback} then ${disputes.id} end)`,
      fraudChargebacks: sql<string>`count(distinct case when ${isChargeback} and ${disputes.reason} in ('fraudulent', 'unrecognized') then ${disputes.id} end)`,
      inquiries: sql<string>`count(distinct case when ${disputes.status} like 'warning\\_%' then ${disputes.id} end)`,
      won: sql<string>`count(distinct case when ${disputes.status} = 'won' then ${disputes.id} end)`,
      lost: sql<string>`count(distinct case when ${disputes.status} = 'lost' then ${disputes.id} end)`,
    })
    .from(orders)
    .leftJoin(
      disputes,
      and(
        eq(disputes.orderId, orders.id),
        /*
         * Connected scope only. A seller's own Sailo subscription chargeback is
         * a platform dispute against Sailo's balance — including it in the
         * shop's storefront rate would have a seller's billing argument count as
         * their buyers' fraud, and could hold their payouts for it.
         */
        eq(disputes.scope, "connected"),
      ),
    )
    .where(and(eq(orders.shopId, shopId), gte(orders.createdAt, since), chargeable(), settled()))
    .groupBy(month)
    .orderBy(month);

  return rows.map((row) => ({
    cohort: new Date(row.cohort),
    settledOrders: Number(row.settledOrders),
    chargebacks: Number(row.chargebacks),
    fraudChargebacks: Number(row.fraudChargebacks),
    inquiries: Number(row.inquiries),
    won: Number(row.won),
    lost: Number(row.lost),
  }));
}

export type ShopDisputeStats = {
  shopId: string;
  cohorts: readonly CohortRate[];
  /** Pooled over cohorts with enough history. Null below the floor. */
  chargebackBp: number | null;
  settledOrders: number;
  /**
   * The pooled tally, over **mature cohorts only** — what decisions are taken on.
   *
   * Excludes this month and last, because their disputes have not finished
   * arriving. That is right for a rate and wrong for a screen, which is why
   * `allTally` exists beside it.
   */
  tally: DisputeTally;
  /**
   * Every dispute in the window, mature or not — what a *person* is shown.
   *
   * Added after a scenario test asserted that five inquiries raised this week
   * appeared in `tally` and found zero. They did not, correctly: `pooledRate`
   * drops immature cohorts so that a shop cannot dilute a bad history by
   * launching a big month. But a seller looking at their own payments page needs
   * to see the dispute that arrived on Tuesday, and a support agent asked "how
   * many has this shop had" is not asking about cohort maturity.
   *
   * Two numbers with two jobs. The one that can hold a payout is `tally`; the one
   * that renders is this. Never compare this to a threshold.
   */
  allTally: DisputeTally;
  /** Settled orders across every cohort in the window, for display beside `allTally`. */
  allSettledOrders: number;
  /** Chargebacks on cohorts too young to have a rate. */
  emergingChargebacks: number;
  /**
   * Chargebacks against charges with no Sailo order behind them.
   *
   * A real case and, until a live run found it, an invisible one. The cohort
   * query joins from `orders`, so a dispute whose `orderId` is null has no row
   * to be counted on and simply does not appear in any rate — a shop taking
   * payments from Stripe's own dashboard could run 20% fraud and read as clean.
   *
   * They cannot have a rate: there is no denominator, because Sailo never saw
   * the sales. So they are counted rather than divided, exactly like the
   * immature-cohort case, and fed into the same `emergingChargebacks` the
   * escalation acts on — three of them is worth a human's attention whatever
   * the rate says.
   */
  unattributedChargebacks: number;
  /** Amount plus fee for every dispute where the money is out and undecided. */
  openDisputeCents: number;
  /** How many still owe a response. */
  awaitingResponse: number;
};

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export async function shopDisputeStats(
  shopId: string,
  now = new Date(),
): Promise<ShopDisputeStats> {
  const db = getDb();
  const since = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - COHORT_MONTHS + 1, 1),
  );

  const [rows, open, unattributed] = await Promise.all([
    cohortRows(shopId, since),
    /*
     * Open exposure, and it is deliberately *not* derived from the cohorts.
     *
     * The cohort query is scoped to twelve months of orders; a dispute against a
     * fourteen-month-old order still has money out of the balance today. Exposure
     * is a question about now, so it is asked about now.
     */
    db
      .select({
        openCents: sql<string>`coalesce(sum(${disputes.deductedCents}), 0)`,
        awaiting: sql<string>`count(case when ${disputes.status} in ('needs_response', 'warning_needs_response') then 1 end)`,
      })
      .from(disputes)
      .where(
        and(
          eq(disputes.shopId, shopId),
          eq(disputes.scope, "connected"),
          isNotNull(disputes.fundsWithdrawnAt),
          /*
           * Undecided only. A lost dispute's money is gone and is no longer
           * exposure — it is a realised loss, and counting it would hold a
           * seller's payouts forever for a case that ended months ago. A won one
           * has been reinstated.
           */
          sql`${disputes.status} in ('needs_response', 'under_review')`,
        ),
      ),
    /*
     * Chargebacks the cohort query cannot see, because they hang off no order.
     *
     * Counted here rather than folded into `cohortRows`: adding them to a cohort
     * would put a numerator over a denominator that never included the sale,
     * inventing a rate out of two unrelated numbers. A count is the only honest
     * thing to say about them.
     */
    db
      .select({ n: sql<string>`count(*)` })
      .from(disputes)
      .where(
        and(
          eq(disputes.shopId, shopId),
          eq(disputes.scope, "connected"),
          isNull(disputes.orderId),
          sql`${disputes.status} not like 'warning\\_%'`,
        ),
      ),
  ]);

  const cohorts = rows.map((row) => {
    const cohort: Cohort = {
      start: monthStart(row.cohort),
      end: monthEnd(row.cohort),
      settledOrders: row.settledOrders,
      tally: {
        chargebacks: row.chargebacks,
        fraudChargebacks: row.fraudChargebacks,
        inquiries: row.inquiries,
        won: row.won,
        lost: row.lost,
      },
    };
    return rateCohort(cohort, now);
  });

  const pooled = pooledRate(cohorts);

  const allTally = cohorts.reduce<DisputeTally>(
    (acc, c) => ({
      chargebacks: acc.chargebacks + c.tally.chargebacks,
      fraudChargebacks: acc.fraudChargebacks + c.tally.fraudChargebacks,
      inquiries: acc.inquiries + c.tally.inquiries,
      won: acc.won + c.tally.won,
      lost: acc.lost + c.tally.lost,
    }),
    EMPTY_TALLY,
  );

  return {
    shopId,
    cohorts,
    chargebackBp: pooled.chargebackBp,
    settledOrders: pooled.settledOrders,
    tally: pooled.tally,
    allTally,
    allSettledOrders: cohorts.reduce((n, c) => n + c.settledOrders, 0),
    /*
     * Both kinds of chargeback that cannot have a rate, added together.
     *
     * A cohort too young to measure and a charge Sailo never saw are different
     * problems with the same shape: a real dispute, no usable denominator. The
     * escalation asks one question of them — "are there enough of these to be
     * worth a look" — so they are summed rather than reported apart.
     */
    emergingChargebacks:
      emergingRisk(cohorts) + Number(unattributed[0]?.n ?? 0),
    unattributedChargebacks: Number(unattributed[0]?.n ?? 0),
    openDisputeCents: Number(open[0]?.openCents ?? 0),
    awaitingResponse: Number(open[0]?.awaiting ?? 0),
  };
}

/**
 * The platform's own ratio, per month of arrival.
 *
 * The one place an arrival-month count is the *right* answer, because it is the
 * one Visa and Mastercard actually compute: disputes raised in a calendar month
 * over transactions settled in that month, platform-wide. This is what decides
 * whether Sailo is fined; `shopDisputeStats` is what decides whether a seller is
 * a problem. Two different questions, and reporting either one as the other is
 * the mistake the whole of `rate.ts` is written around.
 *
 * Mastercard divides by the *previous* month's transaction count, so the caller
 * is given both months rather than a single ratio — see `NETWORK_PROGRAMMES`.
 */
export type PlatformMonth = {
  month: Date;
  settledOrders: number;
  chargebacks: number;
  fraudChargebacks: number;
  inquiries: number;
};

export async function platformDisputeMonths(
  months = 12,
  now = new Date(),
): Promise<PlatformMonth[]> {
  const db = getDb();
  const since = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1),
  );

  const orderMonth = sql<Date>`date_trunc('month', ${orders.createdAt})`;
  const disputeMonth = sql<Date>`date_trunc('month', ${disputes.stripeCreatedAt})`;

  const [volume, raised] = await Promise.all([
    db
      .select({ month: orderMonth, settledOrders: sql<string>`count(*)` })
      .from(orders)
      .where(and(gte(orders.createdAt, since), chargeable(), settled()))
      .groupBy(orderMonth),
    db
      .select({
        month: disputeMonth,
        chargebacks: sql<string>`count(case when ${disputes.status} not like 'warning\\_%' then 1 end)`,
        fraudChargebacks: sql<string>`count(case when ${disputes.status} not like 'warning\\_%' and ${disputes.reason} in ('fraudulent', 'unrecognized') then 1 end)`,
        inquiries: sql<string>`count(case when ${disputes.status} like 'warning\\_%' then 1 end)`,
      })
      .from(disputes)
      .where(gte(disputes.stripeCreatedAt, since))
      .groupBy(disputeMonth),
  ]);

  const byMonth = new Map<number, PlatformMonth>();
  for (const row of volume) {
    const month = new Date(row.month);
    byMonth.set(month.getTime(), {
      month,
      settledOrders: Number(row.settledOrders),
      chargebacks: 0,
      fraudChargebacks: 0,
      inquiries: 0,
    });
  }
  for (const row of raised) {
    const month = new Date(row.month);
    const entry = byMonth.get(month.getTime()) ?? {
      month,
      settledOrders: 0,
      chargebacks: 0,
      fraudChargebacks: 0,
      inquiries: 0,
    };
    entry.chargebacks = Number(row.chargebacks);
    entry.fraudChargebacks = Number(row.fraudChargebacks);
    entry.inquiries = Number(row.inquiries);
    byMonth.set(month.getTime(), entry);
  }

  return [...byMonth.values()].sort((a, b) => a.month.getTime() - b.month.getTime());
}

/**
 * How much of the platform's recent volume can defend itself.
 *
 * The number that says whether the checkout capture is working, and the only
 * honest way to know before disputes arrive. An order without `buyerIp` cannot
 * use Visa's Compelling Evidence 3.0 — the strongest defence against the reason
 * code a small shop receives most — and cannot be fixed later, because the
 * buyer's connection existed for one request.
 *
 * Windowed on the dispute lag: orders from the last 120 days are the ones whose
 * disputes are still to come, so this is a forecast of how defensible the next
 * four months will be.
 */
export async function evidenceCoverage(now = new Date()): Promise<{
  orders: number;
  withIp: number;
  ce3Capable: number;
}> {
  const db = getDb();
  const since = new Date(now.getTime() - DISPUTE_LAG_DAYS * 86_400_000);

  const [row] = await db
    .select({
      total: sql<string>`count(*)`,
      withIp: sql<string>`count(case when ${orders.buyerIp} is not null and ${orders.buyerIp} <> 'unknown' then 1 end)`,
      /*
       * Two data points, which is what CE3.0 requires. An email address plus a
       * purchase IP qualifies; either alone does not.
       */
      ce3: sql<string>`count(case when ${orders.buyerIp} is not null and ${orders.buyerIp} <> 'unknown' and (${orders.customerEmail} is not null or ${orders.buyerDeviceFingerprint} is not null) then 1 end)`,
    })
    .from(orders)
    .where(and(gte(orders.createdAt, since), lt(orders.createdAt, now), chargeable(), settled()));

  return {
    orders: Number(row?.total ?? 0),
    withIp: Number(row?.withIp ?? 0),
    ce3Capable: Number(row?.ce3 ?? 0),
  };
}

export { EMPTY_TALLY };
