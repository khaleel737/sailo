import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, type Order, type Shop } from "@sailo/db/schema";
import { restoreStock } from "./inventory";
import { voidTicketsForOrder } from "./tickets";
import { claimRefundAmount, releaseRefundClaim } from "./refund-claim";
import { checkRefund, refundableCents, reversePayment, type RefundOutcome } from "./refunds";

/**
 * Refunding an order, whole, from either surface.
 *
 * WHY THIS IS ONE FUNCTION AND NOT A SEQUENCE THE CALLER RUNS
 *
 * Every step below is ordered against a failure, and the order is the whole
 * value of the thing. A caller assembling these five calls itself would get one
 * of them wrong eventually, and each wrong ordering loses money in a way no
 * screen shows:
 *
 *   1. **Claim before spending.** `checkRefund` reads a row fetched before this
 *      function called anything, so two refunds issued in the same second both
 *      pass it. `claimRefundAmount` accumulates in SQL and compares column to
 *      column, which is what refuses the loser *before* it has moved money.
 *   2. **Reverse before recording.** An earlier build wrote the refund down and
 *      emailed the buyer without ever calling the processor: the order read
 *      "refunded", the buyer read "your money is on its way", and nothing
 *      moved. A payments product may fail to refund; it may never claim it
 *      refunded when it did not.
 *   3. **Release on failure.** A processor that refuses must not leave the
 *      balance spent, or the seller cannot retry.
 *   4. **Decide fullness from the claim, not the snapshot.** `check.isFull`
 *      came from a row read before the claim, so two partial refunds that
 *      between them consumed the whole balance each read themselves as partial
 *      — and neither restocked nor moved the order to `refunded`. The order sat
 *      fully refunded and still looking paid.
 *   5. **Never write the status backwards.** A partial refund has nothing to
 *      say about the status, so it says nothing. Writing the pre-claim value
 *      back would undo a concurrent caller's conclusion.
 *
 * WHAT IS STILL THE CALLER'S
 *
 * Telling people. The buyer's email, the seller's own dashboard caches, the
 * outbound webhook and the affiliate ledger are all effects with different
 * scheduling on each surface — apps/web has `after()` and a request scope,
 * `packages/api` has neither. They arrive as `hooks`, exactly as
 * `changeOrderStatus` takes them, and the two callers differ only in how they
 * defer.
 */

export type RefundHooks = {
  /**
   * Run after the money has moved and the row is written.
   *
   * apps/web passes Next's `after` so the buyer is not made to wait on an
   * email; `packages/api` has no scheduler and awaits them, which is why this
   * is a hook rather than a `void` call inside.
   */
  defer?: (task: () => Promise<void>) => void;
  /** The buyer's notification. Absent on a surface that cannot send one yet. */
  notify?: (input: { shop: Shop; order: Order }) => Promise<void>;
};

export type RefundResult =
  | {
      ok: true;
      /** What was refunded on this call, not the order's running total. */
      amountCents: number;
      refundedTotal: number;
      isFull: boolean;
      /** Whether a processor actually moved money, or the rail settles offline. */
      outcome: RefundOutcome;
      /**
       * The affiliate who earned on this order, if any.
       *
       * Returned rather than left for the caller to re-query, because the row
       * has already been read here and a refund changes what that affiliate is
       * owed — so every caller needs it and none should have to go back for it.
       */
      affiliateId: string | null;
    }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_positive" | "exceeds_remaining"; remaining: number }
  /** Another refund on this order claimed the balance first. */
  | { ok: false; reason: "raced" }
  /** The processor refused. Nothing was written and the claim was released. */
  | { ok: false; reason: "reversal_failed"; message: string };

export async function refundOrder(
  input: {
    shop: Shop;
    orderId: string;
    /** Minor units. Null refunds whatever is left, not the whole order again. */
    amountCents: number | null;
    reason?: string | null;
  },
  hooks: RefundHooks = {},
): Promise<RefundResult> {
  const db = getDb();

  const order = await db.query.orders.findFirst({
    // Scoped in the WHERE. A refund is the last place to trust a client's id.
    where: and(eq(orders.id, input.orderId), eq(orders.shopId, input.shop.id)),
  });
  if (!order) return { ok: false, reason: "not_found" };

  /* Blank means refund what is left, never the whole order a second time. */
  const requested = input.amountCents ?? refundableCents(order);

  const check = checkRefund(order, requested);
  if (!check.ok) return { ok: false, reason: check.reason, remaining: check.remaining };

  const claimed = await claimRefundAmount(order.id, input.shop.id, requested);
  if (!claimed) return { ok: false, reason: "raced" };

  const isFull = claimed.refundedTotal >= order.totalCents;

  let outcome: RefundOutcome;
  try {
    outcome = await reversePayment(order, requested);
  } catch (error) {
    await releaseRefundClaim(order.id, requested);
    return {
      ok: false,
      reason: "reversal_failed",
      message: error instanceof Error ? error.message : "The payment couldn't be reversed.",
    };
  }

  await db
    .update(orders)
    .set({
      refundedAt: new Date(),
      refundReason: input.reason?.trim().slice(0, 300) || null,
      /* Only ever written *to* `refunded`. A partial refund says nothing about
         the status, so a concurrent caller's conclusion survives. */
      ...(isFull ? { status: "refunded" as const, paymentStatus: "refunded" } : {}),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id));

  /*
   * A fully refunded order is one the buyer no longer has, so the units are
   * available again — and a ticket whose money has been given back must stop
   * opening a door. A partial refund is a price adjustment, not a return.
   */
  if (isFull) {
    await restoreStock(order);
    await voidTicketsForOrder(order.id);
  }

  if (hooks.notify) {
    const notify = hooks.notify;
    /* Re-read, because the row the buyer is told about is the one after the
       write — the refunded total on it is what the email prints. */
    const updated = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    if (updated?.customerEmail) {
      const task = () => notify({ shop: input.shop, order: updated });
      if (hooks.defer) hooks.defer(task);
      else await task();
    }
  }

  return {
    ok: true,
    amountCents: requested,
    refundedTotal: claimed.refundedTotal,
    isFull,
    outcome,
    affiliateId: order.affiliateId,
  };
}
