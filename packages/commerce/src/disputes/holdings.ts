import "server-only";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  disputes,
  downloadEvents,
  orderItems,
  orders,
  shops,
  type Order,
  type Shop,
} from "@sailo/db/schema";
import { formatAddress } from "@sailo/core/address";
import type {
  Ce3Candidate,
  Ce3Identity,
  EvidenceHoldings,
  SoldKind,
} from "@sailo/core/disputes";

/**
 * Reading an order into the flat record `assembleEvidence` works from.
 *
 * The whole of the mapping, and none of the decisions — those are in
 * `@sailo/core/disputes/assemble.ts`, which is pure and where every branch is
 * reachable from a test. This file is the part that has to know that a shop's
 * refund policy is a URL rather than text, and that a digital order's access log
 * lives in a table that did not exist until this pass.
 */

/**
 * `products.kind` narrowed, defaulting to physical.
 *
 * The column is plain text with a `physical` default, and the default is the
 * safe direction: a physical case asks for a carrier and proof of delivery, so a
 * mis-typed digital order produces a readiness panel with too much on it rather
 * than a submission missing the thing that decides it.
 */
function soldKindOf(order: Order): SoldKind {
  if (order.productKind === "digital") return "digital";
  if (order.productKind === "service") return "service";
  return "physical";
}

function addressOf(row: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}): string | null {
  const formatted = formatAddress(row);
  return formatted?.trim() ? formatted : null;
}

/**
 * One line per fetch, in Stripe's `access_activity_log` shape.
 *
 * Timestamp, address, file. Nothing else: an issuer is scanning for a pattern
 * that matches the purchase, and a row of internal ids is noise that makes the
 * pattern harder to see.
 *
 * Capped at 200. The field shares a 20,000-character budget with every other
 * piece of evidence, and a buyer who fetched a file four hundred times has
 * already made the point by the twentieth line.
 */
async function accessLogFor(orderId: string): Promise<string[]> {
  const rows = await getDb()
    .select({
      at: downloadEvents.at,
      ip: downloadEvents.ip,
      fileName: downloadEvents.fileName,
    })
    .from(downloadEvents)
    .where(eq(downloadEvents.orderId, orderId))
    .orderBy(asc(downloadEvents.at))
    .limit(200);

  return rows.map(
    (row) =>
      `${row.at.toISOString()} — ${row.ip ?? "address not recorded"} — ${row.fileName ?? "file"}`,
  );
}

/**
 * Everything on the order, as one sentence an issuer can read.
 *
 * From `orderItems` rather than the header columns, which describe only the first
 * line — a four-line basket described by its header is a product description that
 * does not match the amount charged, and a mismatch there is a gift to the
 * cardholder.
 */
async function productDescriptionFor(order: Order): Promise<string> {
  const items = await getDb()
    .select({
      title: orderItems.title,
      variantLabel: orderItems.variantLabel,
      quantity: orderItems.quantity,
      sku: orderItems.sku,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.position))
    .limit(50);

  if (items.length === 0) {
    // Rows written before carts existed, and any order whose lines were removed.
    return [order.productTitle, order.variantLabel].filter(Boolean).join(" — ");
  }

  return items
    .map((item) => {
      const name = [item.title, item.variantLabel].filter(Boolean).join(" — ");
      const sku = item.sku ? ` (SKU ${item.sku})` : "";
      return `${item.quantity} × ${name}${sku}`;
    })
    .join("; ");
}

/**
 * The other charge a duplicate claim might be about.
 *
 * Same shop, same buyer email, a different order, within a day either side. The
 * window is what makes it a duplicate rather than a repeat customer: two orders
 * a month apart are a returning buyer, and offering one as a "duplicate" invites
 * the issuer to refund a legitimate second sale.
 *
 * Returns whether the two are genuinely distinct, because that decides which
 * argument is honest — and on a real duplicate the honest answer is to refund.
 */
async function duplicateOf(
  order: Order,
): Promise<{ chargeId: string | null; distinct: boolean }> {
  if (!order.customerEmail) return { chargeId: null, distinct: false };

  const day = 86_400_000;
  const rows = await getDb()
    .select({
      id: orders.id,
      intent: orders.stripePaymentIntentId,
      total: orders.totalCents,
      title: orders.productTitle,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, order.shopId),
        eq(orders.customerEmail, order.customerEmail),
        ne(orders.id, order.id),
        sql`${orders.stripePaymentIntentId} is not null`,
        sql`${orders.createdAt} between ${new Date(order.createdAt.getTime() - day)} and ${new Date(order.createdAt.getTime() + day)}`,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);

  const other = rows[0];
  if (!other?.intent) return { chargeId: null, distinct: false };

  /*
   * Same total and same first line inside a day is the same purchase twice.
   * Anything else is two different orders that happen to be close together —
   * which is the case worth arguing.
   */
  const identical = other.total === order.totalCents && other.title === order.productTitle;
  return { chargeId: other.intent, distinct: !identical };
}

/**
 * Gather everything held about an order.
 *
 * `shop` is taken as an argument when the caller already has it — every webhook
 * path does — because this runs inside a handler Stripe is waiting on.
 */
export async function holdingsForOrder(
  order: Order,
  shop?: Shop,
): Promise<EvidenceHoldings> {
  const db = getDb();
  const resolvedShop =
    shop ?? (await db.query.shops.findFirst({ where: eq(shops.id, order.shopId) }));

  const soldKind = soldKindOf(order);
  const [accessLog, productDescription, duplicate] = await Promise.all([
    soldKind === "physical" ? Promise.resolve<string[]>([]) : accessLogFor(order.id),
    productDescriptionFor(order),
    duplicateOf(order),
  ]);

  const address = addressOf(order);

  return {
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    buyerIp: order.buyerIp,
    buyerUserAgent: order.buyerUserAgent,
    buyerDeviceFingerprint: order.buyerDeviceFingerprint,
    /*
     * The client row, not the auth user. Sailo's buyers do not have accounts —
     * a storefront takes an order from a stranger — so the durable identifier
     * for "this person" is the `clients` row the shop keeps, which is keyed on
     * their email per shop. That is what CE3.0's `customer_account_id` is asking
     * for: an id the *business* recognises, which is exactly what a client id is.
     */
    buyerAccountId: order.clientId,

    billingAddress: address,
    /*
     * Only where something is actually going. A shipping address on a download
     * or a membership is a claim about the world that is not true, and Stripe
     * shows it to the issuer beside a product description that says otherwise.
     */
    shippingAddress: soldKind === "physical" ? address : null,

    productDescription,
    soldKind,
    currency: order.currency,
    totalCents: order.totalCents,
    orderReference: order.id,
    placedAt: order.createdAt,

    shippingCarrier: order.trackingCarrier,
    shippingTrackingNumber: order.trackingNumber,
    shippedAt: order.shippedAt,
    serviceAt: order.scheduledFor,
    accessLog,

    termsAcceptedAt: order.termsAcceptedAt,
    /*
     * Null, and honestly so. Sailo stores the seller's terms as a URL
     * (`shops.termsUrl`) and not as text — there is nothing to quote. The
     * disclosure field states the server-stamped acceptance and links the
     * policy, which is what Visa 13.3 and 13.6 actually turn on; Stripe's
     * `refund_policy` is a *file* field, so the document itself is an upload the
     * seller makes and `assembleEvidence` reports as `needs_seller`.
     */
    refundPolicyText: null,
    refundPolicyUrl: resolvedShop?.termsUrl ?? null,
    cancellationPolicyText: null,

    refundedCents: order.refundedCents,
    refundedAt: order.refundedAt,
    refundRefusalExplanation: null,
    duplicateChargeId: duplicate.chargeId,
    duplicateIsDistinct: duplicate.distinct,
    cancelledAt: null,
    customerCommunicationSummary: null,
    /*
     * Empty here, and filled by the caller.
     *
     * Documents belong to the *dispute*, not to the order — an order has no proof
     * of delivery, a case does — so `respond.ts` merges `evidenceFileIdsFor(id)`
     * over this. Leaving it empty is what makes that merge the single place a
     * file field is decided, rather than two half-answers that disagree.
     */
    files: {},
  };
}

/**
 * Turn an order into the identity CE3.0 matches on.
 *
 * Shared by the disputed order and every candidate prior, so the two sides of the
 * comparison are always reduced the same way. Two implementations that merely
 * agree is not one source of truth — and here a disagreement would mean a
 * submission Visa rejects for a reason nobody could diagnose.
 */
export function identityOf(order: Order): Ce3Identity {
  const address = addressOf(order);
  return {
    accountId: order.clientId,
    deviceFingerprint: order.buyerDeviceFingerprint,
    deviceId: null,
    email: order.customerEmail,
    purchaseIp: order.buyerIp,
    shippingAddress: order.productKind === "physical" ? address : null,
  };
}

/**
 * Earlier orders from the same buyer that could support a CE3.0 claim.
 *
 * Selected wide and filtered narrow: this returns every candidate in the same
 * shop from the same buyer, and `selectPriors` in `@sailo/core` applies Visa's
 * window, the undisputed test and the two-matching-points rule. Splitting it that
 * way is what lets the whole of the rule be tested without a database.
 *
 * Matched on `customerEmail` because it is the only durable buyer key a
 * storefront has — Sailo's buyers do not hold accounts. That is a deliberately
 * generous net: a buyer using two addresses produces two identities and loses a
 * qualifying prior, which costs a case; a net that also caught unrelated people
 * would submit someone else's transaction to Visa as evidence, which is worse
 * than losing.
 */
export async function ce3CandidatesFor(order: Order): Promise<Ce3Candidate[]> {
  if (!order.customerEmail) return [];
  const db = getDb();

  const rows = await db
    .select({
      order: orders,
      /*
       * Whether this prior has itself been disputed. A single left join rather
       * than a query per candidate: Visa's window is a year wide, and a returning
       * buyer can have dozens of orders in it.
       */
      disputeId: disputes.id,
    })
    .from(orders)
    .leftJoin(
      disputes,
      and(eq(disputes.orderId, orders.id), eq(disputes.scope, "connected")),
    )
    .where(
      and(
        eq(orders.shopId, order.shopId),
        eq(orders.customerEmail, order.customerEmail),
        ne(orders.id, order.id),
        sql`${orders.stripePaymentIntentId} is not null`,
        sql`${orders.paymentStatus} in ('paid', 'refunded', 'disputed')`,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(100);

  /*
   * One candidate per order, disputed if *any* dispute joined. The left join
   * fans out a twice-disputed order into two rows, and treating those as two
   * separate priors would offer Visa the same charge twice.
   */
  const byOrder = new Map<string, Ce3Candidate>();
  for (const row of rows) {
    const existing = byOrder.get(row.order.id);
    if (existing) {
      if (row.disputeId) existing.disputed = true;
      continue;
    }
    /*
     * The `where` above already requires it, but the row type does not know
     * that. Skipping is the honest narrowing: an assertion here would be a claim
     * about a query someone can edit two lines away, on a value that ends up in
     * a document sent to Visa.
     */
    const intentId = row.order.stripePaymentIntentId;
    if (!intentId) continue;

    byOrder.set(row.order.id, {
      /*
       * A payment intent id, not a charge id, and the caller has to convert it.
       *
       * CE3.0's `prior_undisputed_transactions[].charge` requires a `ch_…`;
       * `orders` stores a `pi_…`. Stripe does not coerce — the field is rejected
       * and the rejection takes the whole `disputes.update` with it, losing the
       * ordinary evidence that was correct. `chargeIdForIntent` in
       * `@sailo/payments/disputes` is the conversion, and `respond.ts` is where
       * it happens; storing the intent id here keeps this function a database
       * read with no Stripe calls in it.
       */
      chargeId: intentId,
      at: row.order.createdAt,
      identity: identityOf(row.order),
      productDescription: row.order.productTitle,
      disputed: Boolean(row.disputeId),
    });
  }

  return [...byOrder.values()];
}
