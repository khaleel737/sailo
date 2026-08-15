import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, type Order, type Shop } from "@sailo/db/schema";
import { isSellerSettablePaymentStatus } from "@sailo/core/payment-status";
import { maybeRow } from "@sailo/core/invariant";
import { releaseDownloads, type ReleaseHooks } from "./downloads";
import { extendForPaidOrder } from "./membership-renewals";

/**
 * The seller saying the money arrived.
 *
 * WHY THIS IS THE MOST PHONE-SHAPED ACTION IN THE PRODUCT
 *
 * There is no card and no webhook on a bank transfer, a handful of cash at a
 * market stall or a WhatsApp arrangement — this write *is* the event that means
 * "paid". Everything downstream of a payment hangs off it, and a seller
 * standing in front of the buyer who just handed them notes is exactly who
 * needs to make it.
 *
 * WHAT MARKING IT PAID ACTUALLY SETS OFF
 *
 * Two things, and neither is optional, which is why this is a function rather
 * than an update statement:
 *
 *   - **The download unlocks.** A digital order held back pending payment is a
 *     buyer who has paid and cannot get their file. `releaseDownloads` opens it
 *     and emails them the link.
 *   - **A manual membership starts or extends.** On a bank transfer there is no
 *     card and no renewal cycle but this one; `extendForPaidOrder` does nothing
 *     for any other kind of order and is idempotent for this one.
 *
 * Shipping either of those separately is how a seller marks an order paid and
 * the buyer still cannot download what they bought.
 *
 * WHY THE ROW IS READ BEFORE IT IS WRITTEN
 *
 * For one reason only: `order.paid` must describe a *transition*. `UPDATE …
 * RETURNING` hands back the new row, so nothing afterwards can tell "the seller
 * just confirmed the money" from "the seller re-saved a dropdown that already
 * said paid" — and a webhook consumer that raises an invoice would raise a
 * second one. Everything else here is idempotent and deliberately runs either
 * way, so the read adds a question rather than changing an answer.
 */

export type PayHooks = {
  defer?: (task: () => Promise<void>) => void;
  /** Fired only on the transition into `paid`, never on a re-save. */
  onNowPaid?: (input: { shop: Shop; order: Order }) => Promise<void>;
  /**
   * The buyer's "your files are ready" email.
   *
   * Passed through to `releaseDownloads` rather than imported, because
   * composing it needs an order's lines and reading those is this package's
   * job — importing the sender made `@sailo/commerce` and `@sailo/email`
   * depend on each other, which turbo refuses. Its own note has the argument.
   */
  notifyDownloads?: ReleaseHooks["notify"];
};

export type PayResult =
  | {
      ok: true;
      /** True only when this call is the one that changed it. */
      becamePaid: boolean;
      /** Whether a held-back download was opened by this call. */
      releasedDownloads: boolean;
    }
  | { ok: false; reason: "not_found" }
  /**
   * A status a seller may not set by hand.
   *
   * `disputed` is the one that is withheld, and `order-status.ts` has the
   * argument: a chargeback is a fact a bank reported, not an opinion the
   * seller holds, and letting them clear it from a control would hide money
   * that has already left their balance. `refunded` *is* settable — recording
   * an off-platform refund is a real thing a seller does — which is why this
   * asks the shared list rather than hard-coding a comparison.
   */
  | { ok: false; reason: "not_settable" };

export async function setPaymentStatus(
  input: { shop: Shop; orderId: string; paymentStatus: string },
  hooks: PayHooks = {},
): Promise<PayResult> {
  if (!isSellerSettablePaymentStatus(input.paymentStatus)) {
    return { ok: false, reason: "not_settable" };
  }

  const db = getDb();

  const before = await db.query.orders.findFirst({
    where: and(eq(orders.id, input.orderId), eq(orders.shopId, input.shop.id)),
    columns: { paymentStatus: true },
  });
  if (!before) return { ok: false, reason: "not_found" };

  /*
   * `maybeRow`, not `firstRow`. The WHERE carries the ownership check, so an id
   * belonging to another shop matches nothing — which is the guard working, not
   * an invariant breaking.
   */
  const updated = maybeRow(
    await db
      .update(orders)
      .set({ paymentStatus: input.paymentStatus, updatedAt: new Date() })
      .where(and(eq(orders.id, input.orderId), eq(orders.shopId, input.shop.id)))
      .returning({ id: orders.id }),
  );
  if (!updated) return { ok: false, reason: "not_found" };

  let releasedDownloads = false;
  const becamePaid = input.paymentStatus === "paid" && before.paymentStatus !== "paid";

  if (input.paymentStatus === "paid") {
    /*
     * Both run on every save to `paid`, not only on the transition, and that is
     * deliberate: each is idempotent, and a seller who re-saves the dropdown
     * after a failed send is trying to make the thing happen. Only the
     * *notification* is guarded on the transition, because that is the one
     * effect a second run would duplicate into somebody's inbox.
     */
    releasedDownloads = await releaseDownloads(updated.id, { notify: hooks.notifyDownloads });
    await extendForPaidOrder(updated.id);
  }

  if (becamePaid && hooks.onNowPaid) {
    const onNowPaid = hooks.onNowPaid;
    const row = await db.query.orders.findFirst({ where: eq(orders.id, updated.id) });
    if (row) {
      const task = () => onNowPaid({ shop: input.shop, order: row });
      if (hooks.defer) hooks.defer(task);
      else await task();
    }
  }

  return { ok: true, becamePaid, releasedDownloads };
}
