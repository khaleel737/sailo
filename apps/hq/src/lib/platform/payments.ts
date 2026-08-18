import "server-only";
import { requireStaff } from "@/lib/session";
import { and, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getReadDb } from "@sailo/db";
import { disputes, orders, shops } from "@sailo/db/schema";
import { HQ_PAGE_SIZE, daysAgo, like, num, paginate } from "./pagination";
import { mergeCurrencyTotals } from "@/lib/metrics";

/**
 * Every payment on the platform, one row each.
 *
 * ─── WHY THIS IS NOT THE ORDERS PAGE ─────────────────────────────────────────
 * /orders answers "what did somebody buy" — the product, the buyer, the
 * fulfilment status, whether it shipped. This answers "what happened to the
 * money", and the two only look alike until something goes wrong with one of
 * them. An order that was paid by card, partially refunded and then charged
 * back is one row on /orders with a status of `refunded`; here it is a payment
 * with a rail, a Stripe id, an amount that no longer matches what was charged,
 * and a dispute hanging off it.
 *
 * The questions this exists for are the ones a payments desk asks and the
 * orders table cannot answer: which rail is this money on, is it on the
 * platform's Stripe account or the seller's, has any of it come back, and is a
 * bank currently arguing about it. None of those is a property of a purchase.
 *
 * ─── WHY THERE IS NO `payments` TABLE ────────────────────────────────────────
 * Because there is nothing to put in it that is not already on `orders`.
 * Sailo is not merchant of record: a card payment is created on the *seller's*
 * connected account and the money never touches a Sailo balance, so the
 * authoritative record of the charge is Stripe's, and ours is the reference to
 * it — `stripe_payment_intent_id`, `stripe_account_id`, `total_cents`,
 * `refunded_cents`, `currency`, `payment_method`. Mirroring Stripe into a table
 * of our own would add a synchronisation problem and a second number for
 * "what was actually charged" that could disagree with the first.
 *
 * So this module is a *projection*, not a store: it reads orders through the
 * money's eyes, joins the dispute if there is one, and adds nothing to the
 * database at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type PaymentFilters = {
  q?: string;
  /** all | card | offline — which rail carried it. */
  rail?: string;
  /** all | paid | refunded | partial | disputed | pending | unpaid */
  state?: string;
  days?: number;
  page?: number;
};

/**
 * Card payments are the ones with a Stripe payment intent on them.
 *
 * Not `payment_method = 'card'`: that column records what the buyer *chose* at
 * checkout, and a seller can name an offline method anything they like. The
 * presence of an intent is what makes a payment one Stripe processed, which is
 * the distinction every question on this page actually turns on — whether there
 * is a Stripe object behind it to look at, refund or dispute.
 */
const isCard = sql`${orders.stripePaymentIntentId} is not null`;

function paymentWhere(filters: PaymentFilters): SQL | undefined {
  const clauses: (SQL | undefined)[] = [];

  if (filters.q?.trim()) {
    const term = filters.q.trim();
    const pattern = like(term);
    clauses.push(
      or(
        ilike(orders.customerName, pattern),
        ilike(orders.customerEmail, pattern),
        ilike(shops.name, pattern),
        ilike(shops.handle, pattern),
        /*
         * The Stripe ids, matched as prefixes rather than substrings. Somebody
         * arriving here has pasted `pi_3Q…` out of the Stripe dashboard or a
         * support email, and a leading wildcard on an indexed text column buys
         * nothing but a sequential scan.
         */
        ilike(orders.stripePaymentIntentId, `${term}%`),
        ilike(orders.stripeSessionId, `${term}%`),
      ),
    );
  }

  switch (filters.rail) {
    case "card":
      clauses.push(isCard);
      break;
    case "offline":
      clauses.push(sql`${orders.stripePaymentIntentId} is null`);
      break;
    default:
      break;
  }

  switch (filters.state) {
    case "paid":
      // Paid and whole — nothing has come back.
      clauses.push(and(eq(orders.paymentStatus, "paid"), eq(orders.refundedCents, 0)));
      break;
    case "partial":
      /*
       * Its own filter rather than folded into `refunded`, because a partial
       * refund is the shape worth looking at: a full refund is a transaction
       * that was undone, and a partial one is an argument that was settled.
       */
      clauses.push(
        sql`${orders.refundedCents} > 0 and ${orders.refundedCents} < ${orders.totalCents}`,
      );
      break;
    case "refunded":
      clauses.push(sql`${orders.refundedCents} >= ${orders.totalCents} and ${orders.refundedCents} > 0`);
      break;
    case "disputed":
      clauses.push(eq(orders.paymentStatus, "disputed"));
      break;
    case "pending":
      clauses.push(eq(orders.paymentStatus, "pending"));
      break;
    case "unpaid":
      clauses.push(eq(orders.paymentStatus, "unpaid"));
      break;
    default:
      break;
  }

  if (filters.days && filters.days > 0) {
    clauses.push(gte(orders.createdAt, daysAgo(filters.days)));
  }

  const present = clauses.filter(Boolean);
  return present.length > 0 ? and(...present) : undefined;
}

export type PaymentRow = {
  orderId: string;
  createdAt: Date;
  shopId: string;
  ownerId: string;
  shopName: string;
  handle: string;
  buyerName: string | null;
  buyerEmail: string | null;
  currency: string;
  totalCents: number;
  refundedCents: number;
  paymentStatus: string;
  paymentMethod: string;
  stripePaymentIntentId: string | null;
  stripeAccountId: string | null;
  /** Set when a bank is, or was, arguing about this one. */
  disputeId: string | null;
  disputeStatus: string | null;
  disputeCents: number;
};

/**
 * One page of payments, with the totals the header reports.
 *
 * Reads the replica. Nothing on this page decides a write — the refund button
 * lives on the dispute detail and re-reads on the primary under `money:move` —
 * so a projection a few hundred milliseconds behind changes what is displayed
 * and never what happens.
 */
export async function getPayments(filters: PaymentFilters = {}) {
  await requireStaff();
  const db = getReadDb();
  const where = paymentWhere(filters);

  const [result, currencyRows, [totals]] = await Promise.all([
    paginate(
      filters.page ?? 1,
      (offset) =>
        db
          .select({
            orderId: orders.id,
            createdAt: orders.createdAt,
            shopId: shops.id,
            ownerId: shops.userId,
            shopName: shops.name,
            handle: shops.handle,
            buyerName: orders.customerName,
            buyerEmail: orders.customerEmail,
            currency: orders.currency,
            totalCents: orders.totalCents,
            refundedCents: orders.refundedCents,
            paymentStatus: orders.paymentStatus,
            paymentMethod: orders.paymentMethod,
            stripePaymentIntentId: orders.stripePaymentIntentId,
            stripeAccountId: orders.stripeAccountId,
            disputeId: disputes.id,
            disputeStatus: disputes.status,
            disputeCents: disputes.amountCents,
          })
          .from(orders)
          .innerJoin(shops, eq(shops.id, orders.shopId))
          /*
           * Left, and on the order rather than on the charge. Almost no payment
           * has a dispute, and an inner join would silently turn this page into
           * a list of the ones that do. One dispute per order in practice; where
           * a charge has been disputed twice this shows the row Postgres
           * returns, and the dispute desk is where that case is worked anyway.
           */
          .leftJoin(disputes, eq(disputes.orderId, orders.id))
          .where(where)
          .orderBy(desc(orders.createdAt))
          .limit(HQ_PAGE_SIZE)
          .offset(offset),

      async () => {
        const [row] = await db
          .select({ n: sql<string>`count(*)` })
          .from(orders)
          .innerJoin(shops, eq(shops.id, orders.shopId))
          .where(where);
        return num(row?.n);
      },
    ),

    /*
     * Volume for the current filter, per currency. Sellers price in their own,
     * so this is a list and never a sum — see `Money` in `hq-ui`.
     */
    db
      .select({
        currency: orders.currency,
        cents: sql<string>`coalesce(sum(${orders.totalCents} - ${orders.refundedCents}), 0)`,
      })
      .from(orders)
      .innerJoin(shops, eq(shops.id, orders.shopId))
      .where(where)
      .groupBy(orders.currency),

    // The three counts the header leads with, over the same filter.
    db
      .select({
        card: sql<string>`count(*) filter (where ${orders.stripePaymentIntentId} is not null)`,
        refunded: sql<string>`count(*) filter (where ${orders.refundedCents} > 0)`,
        disputed: sql<string>`count(*) filter (where ${orders.paymentStatus} = 'disputed')`,
      })
      .from(orders)
      .innerJoin(shops, eq(shops.id, orders.shopId))
      .where(where),
  ]);

  return {
    ...result,
    rows: result.rows.map(
      (r): PaymentRow => ({ ...r, disputeCents: num(r.disputeCents) }),
    ),
    volume: mergeCurrencyTotals(
      currencyRows.map((r) => ({ currency: r.currency, cents: num(r.cents) })),
    ),
    counts: {
      card: num(totals?.card),
      refunded: num(totals?.refunded),
      disputed: num(totals?.disputed),
    },
  };
}

/**
 * The money on one shop, for its account page.
 *
 * The same projection scoped to a shop, so the tab and the platform list cannot
 * disagree about what a payment is.
 */
export async function getShopPayments(shopId: string, limit = 20) {
  await requireStaff();

  const rows = await getReadDb()
    .select({
      orderId: orders.id,
      createdAt: orders.createdAt,
      currency: orders.currency,
      totalCents: orders.totalCents,
      refundedCents: orders.refundedCents,
      paymentStatus: orders.paymentStatus,
      paymentMethod: orders.paymentMethod,
      buyerName: orders.customerName,
      buyerEmail: orders.customerEmail,
      stripePaymentIntentId: orders.stripePaymentIntentId,
      stripeAccountId: orders.stripeAccountId,
      disputeId: disputes.id,
      disputeStatus: disputes.status,
    })
    .from(orders)
    .leftJoin(disputes, eq(disputes.orderId, orders.id))
    .where(and(eq(orders.shopId, shopId), inArray(orders.paymentStatus, ["paid", "refunded", "disputed", "pending"])))
    .orderBy(desc(orders.createdAt))
    .limit(limit);

  return rows;
}
