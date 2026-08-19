import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  disputeEvidenceFiles,
  downloadEvents,
  invoices,
  memberCheckins,
  orderMessages,
  orders,
  policySnapshots,
  shops,
  subscriptions,
  tickets,
  type Dispute,
  type Order,
  type Shop,
} from "@sailo/db/schema";
import {
  EVIDENCE_FILE_BUDGET_BYTES,
  PACK_LOG_CAP,
  fitDocuments,
  packDocuments,
  type PackDocument,
  type PackHoldings,
  type PackKind,
} from "@sailo/core/disputes";
import { isDeliverySource } from "@sailo/core/disputes";
import { evidenceFilesFor } from "./files";

/**
 * Reading an order into the record an evidence pack prints. Spec 45.
 *
 * The whole of the mapping and none of the decisions — those are
 * `@sailo/core/disputes/pack.ts`, which is pure and where every section, every
 * "not on record" line and every provenance string is reachable from a test with
 * no fixtures.
 *
 * ─── RENDERED ON DEMAND, NEVER STORED PER ORDER ────────────────────────────
 *
 * The tempting shape is "generate a PDF when the order is paid and put it in
 * Blob". Two reasons not to, and the second is the codebase's own:
 *
 *   1. A multi-page PDF for every order ever placed is storage and bandwidth
 *      paid on 100% of orders to serve the ~0.1% that get disputed.
 *   2. `disputes.evidenceSnapshot` already documents why a snapshot beats a
 *      reference — *"the order it was assembled from keeps changing: the seller
 *      edits a product, marks something shipped, issues a refund."* The right
 *      unit to make immutable is **the facts**, not the rendering.
 *
 * Spec 44 made the facts durable. This reads them, whenever anybody asks, and
 * "always ready" means always renderable from data that cannot drift — which is
 * stronger than a file written once and never checked again.
 */

/**
 * `products.kind`, narrowed to the five the pack renders differently.
 *
 * A membership is recognised by the order carrying a subscription rather than by
 * the kind column alone, because a renewal order's `productKind` is the
 * membership product's and the signup order's is too — but an ordinary digital
 * order that happens to belong to a subscription must be printed as a membership,
 * since attendance and period history are what answer its dispute.
 */
function packKindOf(order: Order): PackKind {
  if (order.subscriptionId) return "membership";
  switch (order.productKind) {
    case "digital":
      return "digital";
    case "service":
      return "service";
    case "event":
      return "event";
    case "membership":
      return "membership";
    default:
      /*
       * Physical is the default, and it is the safe direction: a physical pack
       * asks for a carrier and a delivery date, so a mis-typed order produces a
       * document with too many "not on record" lines rather than one missing the
       * section that decides the case.
       */
      return "physical";
  }
}

function addressOf(row: Order): string | null {
  const parts = [
    row.addressLine1,
    row.addressLine2,
    row.city,
    row.region,
    row.postalCode,
    row.country,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Gather everything the pack prints for one order.
 *
 * `renderedAt` is an argument. Nothing in the pack reads a clock, so the same
 * order rendered twice produces the same document — which is what makes
 * re-rendering a closed case exact rather than approximate.
 */
export async function packHoldingsForOrder(
  order: Order,
  opts: {
    shop?: Shop;
    renderedAt: Date;
    /** Last four and brand from Stripe's charge. Never anything else. */
    card?: { brand: string | null; last4: string | null };
  },
): Promise<PackHoldings> {
  const db = getDb();
  const shop =
    opts.shop ?? (await db.query.shops.findFirst({ where: eq(shops.id, order.shopId) }));

  const kind = packKindOf(order);

  const [invoice, messages, downloads, ticket, policy, subscription] = await Promise.all([
    db.query.invoices.findFirst({ where: eq(invoices.orderId, order.id) }),
    db
      .select()
      .from(orderMessages)
      .where(eq(orderMessages.orderId, order.id))
      .orderBy(asc(orderMessages.sentAt))
      .limit(PACK_LOG_CAP + 1),
    kind === "physical"
      ? Promise.resolve([])
      : db
          .select()
          .from(downloadEvents)
          .where(eq(downloadEvents.orderId, order.id))
          .orderBy(asc(downloadEvents.at))
          .limit(PACK_LOG_CAP + 1),
    kind === "event"
      ? db.query.tickets.findFirst({ where: eq(tickets.orderId, order.id) })
      : Promise.resolve(undefined),
    /*
     * The policy the buyer agreed to, from the order's own snapshot id — never
     * the shop's current text. Printing today's refund policy against a sale
     * from March is the exact false claim spec 45 forbids, and the snapshot id
     * is what makes the difference expressible at all.
     */
    order.termsSnapshotId
      ? db.query.policySnapshots.findFirst({
          where: eq(policySnapshots.id, order.termsSnapshotId),
        })
      : Promise.resolve(undefined),
    order.subscriptionId
      ? db.query.subscriptions.findFirst({
          where: eq(subscriptions.id, order.subscriptionId),
        })
      : Promise.resolve(undefined),
  ]);

  const [checkIns, renewals] = await Promise.all([
    subscription
      ? db
          .select({ at: memberCheckins.createdAt })
          .from(memberCheckins)
          .where(eq(memberCheckins.subscriptionId, subscription.id))
          .orderBy(asc(memberCheckins.createdAt))
          .limit(PACK_LOG_CAP)
      : Promise.resolve([]),
    subscription
      ? db
          .select({ number: invoices.number, at: invoices.issuedAt })
          .from(invoices)
          .innerJoin(orders, eq(orders.id, invoices.orderId))
          .where(eq(orders.subscriptionId, subscription.id))
          .orderBy(asc(invoices.issuedAt))
          .limit(PACK_LOG_CAP)
      : Promise.resolve([]),
  ]);

  return {
    orderReference: order.id,
    placedAt: order.createdAt,
    kind,
    currency: order.currency,
    totalCents: order.totalCents,
    productDescription: await productDescription(order),
    statementDescriptor: order.statementDescriptor,

    shopName: shop?.name ?? "This shop",
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    billingAddress: addressOf(order),
    shippingAddress: kind === "physical" ? addressOf(order) : null,
    buyerIp: order.buyerIp,
    buyerUserAgent: order.buyerUserAgent,
    /*
     * Deliberately absent from this type and therefore from this object:
     * `buyerDeviceFingerprint`. It goes to Stripe as a CE3.0 match point and
     * means nothing to a human reader, so printing it into a document three
     * people forward by email is exposure with no evidentiary value.
     */
    cardBrand: opts.card?.brand ?? null,
    cardLast4: opts.card?.last4 ?? null,

    invoiceNumber: invoice?.number ?? null,
    invoiceIssuedAt: invoice?.issuedAt ?? null,

    termsAcceptedAt: order.termsAcceptedAt,
    policyText: policy?.body ?? null,
    policyCapturedAt: policy?.capturedAt ?? null,
    policySource: policy?.source ?? null,
    policySourceUrl: policy?.sourceUrl ?? null,

    shippingCarrier: order.trackingCarrier,
    shippingTrackingNumber: order.trackingNumber,
    shippingTrackingUrl: order.trackingUrl,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
    /*
     * Narrowed rather than cast. The column is plain text and a value that is
     * not one of the three would otherwise be printed as a provenance nobody can
     * weigh — the honest answer for an unrecognised source is "source not
     * recorded", which is what a null produces.
     */
    deliveredSource: isDeliverySource(order.deliveredSource) ? order.deliveredSource : null,
    deliverySignedBy: order.deliverySignedBy,

    scheduledFor: order.scheduledFor,
    serviceLocation: order.serviceLocation,
    /*
     * Sailo does not observe an appointment. What it holds is that the shop
     * moved the order to `completed`, and the pack says so in those words.
     */
    serviceCompletedAt: order.status === "completed" ? order.updatedAt : null,
    ticketCode: ticket?.code ?? null,
    ticketUsedAt: ticket?.usedAt ?? null,
    ticketCheckedInBy: ticket?.checkedInBy ?? null,

    membershipStatus: subscription?.status ?? null,
    membershipPeriodEnd: subscription?.currentPeriodEnd ?? null,
    checkIns: checkIns.map((row) => row.at),
    renewalInvoices: renewals.map((row) => ({ number: row.number, at: row.at })),

    downloads: downloads.map((row) => ({
      at: row.at,
      ip: row.ip,
      fileName: row.fileName,
    })),
    downloadReleasedAt: order.downloadReleasedAt,

    messages: messages.map((row) => ({
      at: row.sentAt,
      kind: row.kind,
      direction: row.direction,
      toAddress: row.toAddress,
      subject: row.subject,
      bodyText: row.bodyText,
      status: row.status,
    })),

    refundedCents: order.refundedCents,
    refundedAt: order.refundedAt,

    renderedAt: opts.renderedAt,
  };
}

/**
 * Everything on the order as one sentence, from the *lines*.
 *
 * The header describes only the first line, and a four-line basket described by
 * its header is a product description that does not match the amount charged —
 * which is a gift to a cardholder. `holdings.ts` already makes this argument for
 * the Stripe payload; the pack prints the same sentence so the two documents
 * cannot disagree about what was sold.
 */
async function productDescription(order: Order): Promise<string> {
  const { orderItems } = await import("@sailo/db/schema");
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
    return [order.productTitle, order.variantLabel].filter(Boolean).join(" — ");
  }

  return items
    .map((item) => {
      const name = [item.title, item.variantLabel].filter(Boolean).join(" — ");
      return `${item.quantity} × ${name}${item.sku ? ` (SKU ${item.sku})` : ""}`;
    })
    .join("; ");
}

/* -------------------------------------------------------------------------- */
/*  Which documents to offer                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The documents that fit alongside whatever the seller has already uploaded.
 *
 * `fitDocuments` is lowest-value-first-out, and the ordering is the point: a
 * seller's real carrier proof of delivery beats Sailo's account of what Sailo
 * saw, so if the 4.5 MB ceiling is tight, ours yields. The seller's files are
 * never candidates for eviction — a generator that could push one out would be
 * the worst possible bug in this feature.
 */
export async function offerablePackDocuments(
  disputeId: string,
  holdings: PackHoldings,
): Promise<{ include: PackDocument[]; dropped: PackDocument[] }> {
  const held = await evidenceFilesFor(disputeId);

  /*
   * Only the seller's own uploads count against the budget here. A generated
   * document from an earlier run occupies the same field and is replaced by the
   * upsert rather than added to, so counting it would make each re-render look
   * more expensive than the one before.
   */
  const sellerBytes = held
    .filter((file) => file.uploadedBy !== SAILO_UPLOADER)
    .reduce((sum, file) => sum + file.bytes, 0);

  return fitDocuments(packDocuments(holdings), sellerBytes, EVIDENCE_FILE_BUDGET_BYTES);
}

/**
 * Who a generated document says uploaded it.
 *
 * The same value spec 45 names, and it is load-bearing in two places: the
 * readiness panel shows the slot as `held` rather than `needs_seller` when it is
 * present, and `offerablePackDocuments` excludes these rows from the budget so a
 * re-render does not appear to cost twice.
 */
export const SAILO_UPLOADER = "sailo:auto";

/** Whether a document on this field was generated rather than uploaded. */
export async function generatedFields(disputeId: string): Promise<Set<string>> {
  const held = await evidenceFilesFor(disputeId);
  return new Set(
    held.filter((file) => file.uploadedBy === SAILO_UPLOADER).map((file) => file.field),
  );
}

/**
 * Drop Sailo's own generated document off a field, so a seller's upload can take
 * it.
 *
 * Called before an upload rather than after: `attachEvidenceFile` checks the
 * combined ceiling against what is held *at that moment*, and a generated
 * document still sitting on another field is what would refuse a seller's real
 * proof of delivery at the one moment it matters.
 */
export async function evictGeneratedFor(
  disputeId: string,
  incomingBytes: number,
): Promise<number> {
  const held = await evidenceFilesFor(disputeId);
  const spent = held.reduce((sum, file) => sum + file.bytes, 0);
  if (spent + incomingBytes <= EVIDENCE_FILE_BUDGET_BYTES) return 0;

  /*
   * Largest generated document first, and only as many as the incoming file
   * needs. Evicting all of them would throw away evidence to make room that was
   * not asked for.
   */
  const generated = held
    .filter((file) => file.uploadedBy === SAILO_UPLOADER)
    .sort((a, b) => b.bytes - a.bytes);

  const db = getDb();
  let freed = 0;
  let removed = 0;

  for (const file of generated) {
    if (spent + incomingBytes - freed <= EVIDENCE_FILE_BUDGET_BYTES) break;
    await db
      .delete(disputeEvidenceFiles)
      .where(
        and(
          eq(disputeEvidenceFiles.disputeId, disputeId),
          eq(disputeEvidenceFiles.field, file.field),
        ),
      );
    freed += file.bytes;
    removed += 1;
  }

  return removed;
}

/** The order behind a dispute, for the caller that needs both. */
export async function orderForDispute(dispute: Dispute): Promise<Order | null> {
  if (!dispute.orderId) return null;
  const row = await getDb().query.orders.findFirst({
    where: eq(orders.id, dispute.orderId),
  });
  return row ?? null;
}

/** The newest dispute against an order, for the seller's own pack button. */
export async function latestDisputeForOrder(orderId: string) {
  const { disputes } = await import("@sailo/db/schema");
  return getDb().query.disputes.findFirst({
    where: eq(disputes.orderId, orderId),
    orderBy: [desc(disputes.createdAt)],
  });
}
