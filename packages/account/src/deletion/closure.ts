import "server-only";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  disputes,
  orders,
  products,
  shopClosures,
  type Shop,
} from "@sailo/db/schema";
import { closureFingerprint } from "./fingerprint";

/**
 * The record a closed shop leaves behind.
 *
 * Written by `deleteAccountFor` immediately before the tombstone, because every
 * number in it is read from rows the next four steps delete. Order is the whole
 * design: run this afterwards and it records a shop with no products, no
 * buyers and an owner called "Deleted user".
 *
 * ─── WHAT DECIDES WHETHER WE KEEP THE NAME ───────────────────────────────────
 * See `packages/db/src/schema/closures.ts` for the full argument. The short
 * version: the shape of the business is kept on every closure, and the readable
 * identity is kept only when the closure happened under suspicion. `suspicion`
 * is the four tests in `closedUnderSuspicion` below, and each one is a fact
 * already on the row rather than a judgement made here — a staff member has
 * suspended them, a staff member has held their payouts, buyers have money in
 * with nothing delivered, or a card network has an open case against them.
 *
 * The tests are deliberately about *evidence*, not *suspicion*: "we had a
 * feeling" is not a lawful basis and would in practice mean keeping everyone.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Up to fifty product titles. See the column's note for why fifty. */
const CATALOGUE_CAP = 50;

/** `count(*)` and `sum(...)` come back as strings over the wire. */
const n = (value: unknown) => Number(value ?? 0);

export type ClosureInput = {
  shop: Shop;
  owner: { id: string; name: string | null; email: string } | null;
  closedBy: "seller" | "staff";
  closedByEmail?: string | null;
  reason?: string | null;
  /** `BETTER_AUTH_SECRET`, handed in so the hashing stays testable. */
  fingerprintKey: string;
};

/**
 * What the shop was, gathered in one round of parallel reads.
 *
 * Seven queries, once, on a path that runs when somebody deletes their account
 * — which is rare enough that the cost is not worth optimising and important
 * enough that being incomplete is. Every one is bounded by `shopId`.
 */
async function snapshot(shopId: string) {
  const db = getDb();

  const [
    [orderRow],
    [undelivered],
    [disputeRow],
    [productRow],
    [buyerRow],
    catalogue,
  ] = await Promise.all([
    db
      .select({
        orders: sql<string>`count(*)`,
        paid: sql<string>`count(*) filter (where ${orders.paymentStatus} = 'paid')`,
        /*
         * Cancelled orders are excluded from the money and counted in `orders`,
         * matching how every other surface in the platform reports volume. A
         * closure record that disagreed with the accounts page about what a
         * shop turned over would be the first thing anyone queried.
         */
        gross: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} <> 'cancelled'), 0)`,
        refunded: sql<string>`coalesce(sum(${orders.refundedCents}), 0)`,
        first: sql<Date | null>`min(${orders.createdAt})`,
        last: sql<Date | null>`max(${orders.createdAt})`,
      })
      .from(orders)
      .where(eq(orders.shopId, shopId)),

    /*
     * The number this whole table exists for: buyers who paid and got nothing.
     *
     * Deliberately wider than `openObligations`, which is the *refusal* and is
     * narrow on purpose so an unpaid cash-on-delivery order cannot trap someone
     * in an account for ever. This is the *record*, and it counts every paid
     * order still sitting in `new` or `confirmed` however it was going to be
     * fulfilled — because "took forty payments, delivered none, left" is the
     * finding, and a definition that excluded digital goods would miss the
     * cheapest fraud on the platform to commit.
     */
    db
      .select({ n: count() })
      .from(orders)
      .where(
        and(
          eq(orders.shopId, shopId),
          eq(orders.paymentStatus, "paid"),
          inArray(orders.status, ["new", "confirmed"]),
        ),
      ),

    db
      .select({
        total: sql<string>`count(*)`,
        /*
         * `needs_response` and `under_review` — the two statuses that mean a
         * card network still has a live case. The same pair `shopDisputeStats`
         * calls open, written out again rather than imported, because pulling
         * it across would make `@sailo/account` depend on `@sailo/commerce` for
         * one array. Widening this list makes more closures retain identity,
         * which is only the safe direction to be wrong in if somebody meant it.
         */
        openCents: sql<string>`coalesce(sum(${disputes.amountCents}) filter (where ${disputes.status} in ('needs_response', 'under_review')), 0)`,
      })
      .from(disputes)
      .where(eq(disputes.shopId, shopId)),

    db.select({ n: count() }).from(products).where(eq(products.shopId, shopId)),
    db.select({ n: count() }).from(clients).where(eq(clients.shopId, shopId)),

    db
      .select({
        title: products.title,
        kind: products.kind,
        priceCents: products.priceCents,
      })
      .from(products)
      .where(eq(products.shopId, shopId))
      .limit(CATALOGUE_CAP),
  ]);

  return {
    orderCount: n(orderRow?.orders),
    paidOrderCount: n(orderRow?.paid),
    grossCents: n(orderRow?.gross),
    refundedCents: n(orderRow?.refunded),
    firstOrderAt: orderRow?.first ? new Date(orderRow.first) : null,
    lastOrderAt: orderRow?.last ? new Date(orderRow.last) : null,
    undeliveredPaidOrders: undelivered?.n ?? 0,
    disputeCount: n(disputeRow?.total),
    openDisputeCents: n(disputeRow?.openCents),
    productCount: productRow?.n ?? 0,
    buyerCount: buyerRow?.n ?? 0,
    catalogue,
  };
}

/**
 * Whether this closure keeps the seller's readable identity.
 *
 * Four tests, each one a fact already recorded rather than an opinion formed
 * here — which is what makes the retention defensible if it is ever challenged.
 * A seller who trips none of them leaves with their name erased and their
 * business's shape kept, which is the promise the deletion flow makes.
 */
function closedUnderSuspicion(
  shop: Shop,
  snap: Awaited<ReturnType<typeof snapshot>>,
  closedBy: "seller" | "staff",
): boolean {
  return (
    // A staff member suspended the storefront.
    shop.suspendedAt !== null ||
    // A staff member, or the dispute ladder, stopped the money leaving.
    shop.payoutsPausedAt !== null ||
    // A card network has a live case against them.
    snap.openDisputeCents > 0 ||
    // Buyers have paid for something they have not received.
    snap.undeliveredPaidOrders > 0 ||
    /*
     * We closed it, rather than them. A staff closure is by definition a
     * decision somebody made about this shop, and the record of it is worth
     * nothing if it cannot name who it was about.
     */
    closedBy === "staff"
  );
}

/**
 * Write the closure record. Idempotent, like every other step of the deletion.
 *
 * A retry after a crash re-reads whatever survives and overwrites the row
 * rather than adding a second one, which is why the conflict target is the
 * shop. The numbers on a second pass will be smaller — the catalogue is gone by
 * then — so the update deliberately keeps the *larger* of the two for every
 * count, and keeps the identity if either pass retained one. A retry must never
 * be able to launder a record into a thinner one.
 */
export async function recordClosure(input: ClosureInput): Promise<void> {
  const { shop, owner, closedBy, fingerprintKey } = input;
  const snap = await snapshot(shop.id);
  const suspicion = closedUnderSuspicion(shop, snap, closedBy);

  const row = {
    shopId: shop.id,
    userId: shop.userId,
    closedBy,
    closedByEmail: input.closedByEmail?.trim().toLowerCase() || null,
    reason: input.reason?.trim().slice(0, 500) || null,

    identityRetained: (suspicion ? "suspicion" : "none") as "suspicion" | "none",
    ownerName: suspicion ? (owner?.name ?? null) : null,
    ownerEmail: suspicion ? (owner?.email ?? null) : null,
    shopName: suspicion ? shop.name : null,
    contactEmail: suspicion ? shop.contactEmail : null,
    location: suspicion ? shop.location : null,

    // Always, and never the address itself.
    ownerEmailHash: closureFingerprint(owner?.email, fingerprintKey),

    handle: shop.handle,
    currency: shop.currency,

    orderCount: snap.orderCount,
    paidOrderCount: snap.paidOrderCount,
    grossCents: snap.grossCents,
    refundedCents: snap.refundedCents,
    undeliveredPaidOrders: snap.undeliveredPaidOrders,
    disputeCount: snap.disputeCount,
    openDisputeCents: snap.openDisputeCents,
    productCount: snap.productCount,
    buyerCount: snap.buyerCount,
    firstOrderAt: snap.firstOrderAt,
    lastOrderAt: snap.lastOrderAt,
    shopCreatedAt: shop.createdAt,

    suspendedAt: shop.suspendedAt,
    suspendedReason: shop.suspendedReason,
    payoutsPausedAt: shop.payoutsPausedAt,
    staffNote: shop.staffNote,

    stripeAccountId: shop.stripeAccountId,
    stripeCustomerId: shop.stripeCustomerId,

    catalogue: snap.catalogue,
  };

  await getDb()
    .insert(shopClosures)
    .values(row)
    .onConflictDoUpdate({
      target: shopClosures.shopId,
      set: {
        /*
         * Greatest, not newest. The second pass of a retried deletion sees a
         * half-erased shop, and taking its numbers would quietly replace a
         * complete record with a thinner one — which is the exact failure this
         * table exists to prevent, arriving through the back door.
         */
        orderCount: sql`greatest(${shopClosures.orderCount}, ${row.orderCount})`,
        paidOrderCount: sql`greatest(${shopClosures.paidOrderCount}, ${row.paidOrderCount})`,
        grossCents: sql`greatest(${shopClosures.grossCents}, ${row.grossCents})`,
        refundedCents: sql`greatest(${shopClosures.refundedCents}, ${row.refundedCents})`,
        undeliveredPaidOrders: sql`greatest(${shopClosures.undeliveredPaidOrders}, ${row.undeliveredPaidOrders})`,
        disputeCount: sql`greatest(${shopClosures.disputeCount}, ${row.disputeCount})`,
        openDisputeCents: sql`greatest(${shopClosures.openDisputeCents}, ${row.openDisputeCents})`,
        productCount: sql`greatest(${shopClosures.productCount}, ${row.productCount})`,
        buyerCount: sql`greatest(${shopClosures.buyerCount}, ${row.buyerCount})`,
        /*
         * `coalesce(existing, new)` throughout: the first pass is the one that
         * could see anything, so what it wrote wins and the second pass only
         * fills in a null. Identity is never downgraded from `suspicion`.
         */
        identityRetained: sql`case when ${shopClosures.identityRetained} = 'suspicion' then 'suspicion' else ${row.identityRetained} end`,
        ownerName: sql`coalesce(${shopClosures.ownerName}, ${row.ownerName})`,
        ownerEmail: sql`coalesce(${shopClosures.ownerEmail}, ${row.ownerEmail})`,
        shopName: sql`coalesce(${shopClosures.shopName}, ${row.shopName})`,
        contactEmail: sql`coalesce(${shopClosures.contactEmail}, ${row.contactEmail})`,
        ownerEmailHash: sql`coalesce(${shopClosures.ownerEmailHash}, ${row.ownerEmailHash})`,
        catalogue: sql`case when jsonb_array_length(${shopClosures.catalogue}) >= ${snap.catalogue.length} then ${shopClosures.catalogue} else ${JSON.stringify(snap.catalogue)}::jsonb end`,
      },
    });
}

/*
 * "Have we seen this address before?" is deliberately NOT here.
 *
 * It was, briefly: a `closuresForEmail(email, key)` beside `recordClosure`,
 * which computed the digest and selected the matching rows. It went, because
 * apps/hq needs the same question answered under `requireStaff` and with the
 * columns its screens render, and it had written its own — see
 * `priorClosuresFor` and `getReturningSellers` in `lib/platform/closures.ts`.
 *
 * Two implementations of "is this the person who closed that shop" is exactly
 * the drift this package exists to prevent, and shipping an unused one on the
 * grounds that a signup hook might want it later is how the second definition
 * gets written by somebody who never saw the first. When a signup path does
 * need it, the honest move is to lift HQ's version here and have both call it —
 * with the fingerprint, which is the part that genuinely must not be duplicated
 * and which already lives in `./fingerprint`.
 */
