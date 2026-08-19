import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  accountEvents,
  orderMessages,
  orders,
  policySnapshots,
} from "@sailo/db/schema";
import {
  isStorablePolicy,
  normalisePolicy,
  policyHash,
  redactTokens,
  type AccountEventKind,
  type DeliverySource,
  type MessageKind,
  type MessageStatus,
  type PolicyKind,
  type PolicySource,
} from "@sailo/core/disputes";

/**
 * Writing down what a chargeback will be answered with. Spec 44.
 *
 * Four writers, and one rule that governs all of them:
 *
 * **None of these may throw into its caller.** Every one runs on a path a buyer
 * or Stripe is waiting on — order creation, a webhook, a confirmation send — and
 * failing a settled payment because an evidence row could not be written would
 * trade a real transaction for a hypothetical dispute. `confirm-buyer.ts`
 * already documents this failure mode; these follow it. Each logs and returns a
 * null-ish answer, and the readiness panel already knows how to report a missing
 * fact as `missing`, which is the truth.
 *
 * The second rule is the one specs 45 and 46 turn on: **never record a fact
 * Sailo does not hold.** A message row is written where the send *succeeded*, not
 * where it was attempted. A delivery is recorded with the source that asserted
 * it. An evidence document that overstates is a false claim to a bank made on
 * the seller's behalf, and it loses the case as well as damaging them.
 */

/* -------------------------------------------------------------------------- */
/*  Policy snapshots                                                          */
/* -------------------------------------------------------------------------- */

export type SnapshotInput = {
  /** Null for Sailo's own terms — see the schema's note on the two indexes. */
  shopId: string | null;
  kind: PolicyKind;
  body: string;
  source: PolicySource;
  sourceUrl?: string | null;
};

/**
 * Store a policy's text, or find the row that already holds it.
 *
 * Content-addressed, so this is cheap enough to call on every order: a shop with
 * a stable policy has one row for its whole life and this returns that row's id
 * every time. Only an edit inserts.
 *
 * Returns null when there is nothing worth storing — an empty policy, a fetch
 * that returned a 404 page, a body past the cap. A null on the order is honest
 * and the panel reports it as missing; a snapshot of a cookie banner would be
 * printed in an evidence pack as though it were the seller's refund terms.
 */
export async function snapshotPolicy(input: SnapshotInput): Promise<string | null> {
  try {
    if (!isStorablePolicy(input.body)) return null;

    const body = normalisePolicy(input.body);
    const contentHash = await policyHash(body);
    const db = getDb();

    /*
     * Read before write, then insert with the conflict handled.
     *
     * The read is the common path by a wide margin — most orders reuse a
     * snapshot — and skipping the insert entirely is what keeps this off the
     * write path of a checkout. The insert still has to handle a conflict
     * because two concurrent first-orders can both miss the read.
     */
    const existing = await findSnapshot(input.shopId, input.kind, contentHash);
    if (existing) return existing;

    const [row] = await db
      .insert(policySnapshots)
      .values({
        shopId: input.shopId,
        kind: input.kind,
        contentHash,
        body,
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
      })
      /*
       * `onConflictDoNothing` without a target, because the two unique indexes
       * are partial — one for shops, one for the platform's NULL `shop_id` — and
       * naming either would leave the other unhandled. Nothing returns on a
       * conflict, so the read below finds the winner's row.
       */
      .onConflictDoNothing()
      .returning({ id: policySnapshots.id });

    return row?.id ?? (await findSnapshot(input.shopId, input.kind, contentHash));
  } catch (error) {
    console.error("[sailo] policy snapshot failed", error);
    return null;
  }
}

async function findSnapshot(
  shopId: string | null,
  kind: PolicyKind,
  contentHash: string,
): Promise<string | null> {
  const row = await getDb().query.policySnapshots.findFirst({
    where: and(
      shopId === null ? isNull(policySnapshots.shopId) : eq(policySnapshots.shopId, shopId),
      eq(policySnapshots.kind, kind),
      eq(policySnapshots.contentHash, contentHash),
    ),
    columns: { id: true },
  });
  return row?.id ?? null;
}

/** The newest snapshot of a kind for a shop, for a surface that shows one. */
export async function latestSnapshot(
  shopId: string | null,
  kind: PolicyKind,
): Promise<{ id: string; body: string; capturedAt: Date } | null> {
  const row = await getDb().query.policySnapshots.findFirst({
    where: and(
      shopId === null ? isNull(policySnapshots.shopId) : eq(policySnapshots.shopId, shopId),
      eq(policySnapshots.kind, kind),
    ),
    orderBy: [desc(policySnapshots.capturedAt)],
    columns: { id: true, body: true, capturedAt: true },
  });
  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/*  The message log                                                           */
/* -------------------------------------------------------------------------- */

export type LogMessageInput = {
  orderId: string;
  shopId: string;
  kind: MessageKind;
  direction?: "outbound" | "inbound";
  toAddress?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  providerMessageId?: string | null;
  status?: MessageStatus;
};

/**
 * Record a message that was sent — or one the seller pasted in.
 *
 * `bodyText` is redacted on the way in, not on the way out. These rows are read
 * by staff and printed into a document that goes to a card network, and a live
 * download token would be sitting in both: redacting at the write means there is
 * never a moment where the token is in the row at all. `redactTokens` keeps the
 * URL's shape, so the evidence — a download link was sent, then, to that address
 * — survives intact.
 */
export async function logOrderMessage(input: LogMessageInput): Promise<void> {
  try {
    await getDb().insert(orderMessages).values({
      orderId: input.orderId,
      shopId: input.shopId,
      kind: input.kind,
      direction: input.direction ?? "outbound",
      toAddress: input.toAddress ?? null,
      subject: input.subject ?? null,
      bodyText: input.bodyText ? redactTokens(input.bodyText) : null,
      providerMessageId: input.providerMessageId ?? null,
      status: input.status ?? "sent",
    });
  } catch (error) {
    /*
     * Swallowed, like everything here. This runs immediately after a
     * confirmation email actually went out; throwing would fail a settled order
     * for the sake of a row about it.
     */
    console.error("[sailo] order message log failed", error);
  }
}

/**
 * Update what the provider later said about a message.
 *
 * Called from the signature-verified Resend webhook that already handles bounces
 * and complaints for broadcasts. A bounced confirmation is evidence in its own
 * right — it explains why a buyer says they never heard anything — so this
 * records the bad news as readily as the good.
 */
export async function markMessageStatus(
  providerMessageId: string,
  status: MessageStatus,
): Promise<void> {
  try {
    await getDb()
      .update(orderMessages)
      .set({ status })
      .where(eq(orderMessages.providerMessageId, providerMessageId));
  } catch (error) {
    console.error("[sailo] order message status update failed", error);
  }
}

/** Every message about one order, oldest first, for the pack and the panel. */
export async function messagesForOrder(orderId: string) {
  return getDb()
    .select()
    .from(orderMessages)
    .where(eq(orderMessages.orderId, orderId))
    .orderBy(orderMessages.sentAt);
}

/* -------------------------------------------------------------------------- */
/*  Delivery confirmation                                                     */
/* -------------------------------------------------------------------------- */

export type DeliveryResult =
  | { ok: true; alreadyConfirmed: boolean }
  | { ok: false; error: string };

/**
 * Record that an order arrived.
 *
 * A **conditional** claim, and that is the whole of its correctness. The buyer's
 * "yes, this arrived" button is a public route on a link anybody holding it can
 * open, so a double-click, a prefetching mail client and a refresh all arrive as
 * repeat calls — and the second must not move the date. Whoever confirms first
 * is what the record says.
 *
 * The source is recorded beside the date because the three are not equally
 * persuasive and an evidence pack prints which. A seller's tick presented as
 * though a carrier had signed for it is a false claim to a bank.
 */
export async function confirmDelivery(opts: {
  orderId: string;
  source: DeliverySource;
  signedBy?: string | null;
  at?: Date;
}): Promise<DeliveryResult> {
  try {
    const [claimed] = await getDb()
      .update(orders)
      .set({
        deliveredAt: opts.at ?? new Date(),
        deliveredSource: opts.source,
        deliverySignedBy: opts.signedBy ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, opts.orderId), isNull(orders.deliveredAt)))
      .returning({ id: orders.id });

    if (claimed) return { ok: true, alreadyConfirmed: false };

    /*
     * No row matched. Either the order does not exist or it was already
     * confirmed, and the two want different answers — a buyer clicking twice
     * should be told it is recorded, not that their order is missing.
     */
    const exists = await getDb().query.orders.findFirst({
      where: eq(orders.id, opts.orderId),
      columns: { id: true },
    });
    return exists
      ? { ok: true, alreadyConfirmed: true }
      : { ok: false, error: "not_found" };
  } catch (error) {
    console.error("[sailo] delivery confirmation failed", error);
    return { ok: false, error: "unavailable" };
  }
}

/**
 * Orders that were shipped and never confirmed as arrived.
 *
 * The nudge on the seller's orders list. A shipped physical order with no
 * `deliveredAt` past the carrier's typical window is a hole somebody can still
 * close; leaving it silent is how the `product_not_received` slot stays empty
 * until the day it is needed.
 */
export async function awaitingDeliveryConfirmation(
  shopId: string,
  olderThanDays = 7,
  limit = 50,
) {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  return getDb()
    .select({
      id: orders.id,
      productTitle: orders.productTitle,
      customerName: orders.customerName,
      shippedAt: orders.shippedAt,
      trackingNumber: orders.trackingNumber,
    })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, shopId),
        isNull(orders.deliveredAt),
        sql`${orders.shippedAt} is not null and ${orders.shippedAt} < ${cutoff}`,
      ),
    )
    .orderBy(orders.shippedAt)
    .limit(limit);
}

/* -------------------------------------------------------------------------- */
/*  Account events                                                            */
/* -------------------------------------------------------------------------- */

export type AccountEventInput = {
  userId: string;
  shopId?: string | null;
  kind: AccountEventKind;
  ip?: string | null;
  userAgent?: string | null;
  city?: string | null;
  country?: string | null;
  detail?: Record<string, unknown> | null;
};

/**
 * Record something that happened to an account, durably.
 *
 * better-auth's `session` already carries all of this and then removes it on
 * expiry, so a subscription chargeback arriving 120 days after the seller's last
 * sign-in finds nothing to answer with. One insert on a hook that had already
 * resolved the geo.
 *
 * **A record, never a gate.** Nothing reads these to decide anything, for the
 * reason `client-ip.ts` gives: every value here is a header the client can set.
 * As an observation reported to an issuer that is fine — they are being told
 * what we saw, not what we verified — and as access control it would be
 * worthless.
 */
export async function recordAccountEvent(input: AccountEventInput): Promise<void> {
  try {
    await getDb().insert(accountEvents).values({
      userId: input.userId,
      shopId: input.shopId ?? null,
      kind: input.kind,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      detail: input.detail ?? null,
    });
  } catch (error) {
    /*
     * Swallowed hard. This is on the sign-in path: an evidence row failing to
     * write must never be the reason somebody cannot get into their shop.
     */
    console.error("[sailo] account event failed", error);
  }
}

/** An account's history, newest first — the read behind spec 46. */
export async function accountHistory(userId: string, limit = 200) {
  return getDb()
    .select()
    .from(accountEvents)
    .where(eq(accountEvents.userId, userId))
    .orderBy(desc(accountEvents.at))
    .limit(limit);
}
