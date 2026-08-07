"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { maybeRow } from "@/lib/invariant";
import { rateLimit } from "@/lib/redis";
import { callerIp } from "@/lib/client-ip";
import { checkPaymentReference, TRANSFERABLE_PAYMENT_STATUSES } from "@/lib/payments/status";
import { PAYMENT_METHOD_DEFS, PAYMENT_METHOD_TYPES } from "@/lib/payments";

/**
 * A buyer telling the seller they have sent the money.
 *
 * Split out of `orders.ts` because it answers a different question from the
 * other two actions there. `createOrderIntent` places an order and
 * `previewOrder` prices a basket; this one is the buyer coming back afterwards,
 * on a rail the seller settles by hand, to quote the reference on their
 * transfer. It shares nothing with them but the table.
 */

/**
 * The rails on which a reference means anything.
 *
 * Derived from the rail taxonomy rather than written out, so it cannot drift
 * from it: a `manual` rail is one where the buyer sends the money themselves
 * and the seller confirms it later, which is exactly the situation a reference
 * describes. `electronic` rails confirm themselves and `contact` rails settle
 * off-platform entirely.
 */
const REFERENCEABLE_RAILS = PAYMENT_METHOD_TYPES.filter(
  (type) => PAYMENT_METHOD_DEFS[type].kind === "manual",
);

export async function submitPaymentReference(input: {
  orderId: string;
  reference: string;
}): Promise<{ ok: boolean; error?: string }> {
  // Writes to someone else's order, identified only by its id.
  const gate = await rateLimit(`payref:${await callerIp()}`, 10, 60);
  if (!gate.allowed) {
    return { ok: false, error: "Too many attempts. Wait a moment and try again." };
  }

  const db = getDb();
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, input.orderId),
    columns: { id: true, paymentStatus: true, paymentMethod: true },
  });
  if (!order) return { ok: false, error: "Order not found." };

  const check = checkPaymentReference(order, input.reference);
  if (!check.ok) return { ok: false, error: check.error };

  /*
   * The status is repeated in the WHERE clause, and the rail with it.
   *
   * The status, because a chargeback arriving between the read and the write
   * would otherwise be overwritten by this update — the very thing the check
   * exists to prevent, in the window where it matters most.
   *
   * The rail, because this action is public and finds its order by id alone.
   * An abandoned *card* checkout also sits at `unpaid`, and moving one to
   * `pending` hid it from `releaseAbandonedCheckouts`, whose predicate is
   * `unpaid` plus the card rail — so anyone holding an order id could park a
   * shop's stock off the shelf permanently, repeatably. A transfer reference
   * is meaningless on a card order anyway: nobody transfers money for one.
   */
  const updated = maybeRow(
    await db
      .update(orders)
      .set({ paymentReference: check.reference, paymentStatus: "pending", updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, input.orderId),
          inArray(orders.paymentStatus, [...TRANSFERABLE_PAYMENT_STATUSES]),
          inArray(orders.paymentMethod, [...REFERENCEABLE_RAILS]),
        ),
      )
      .returning({ id: orders.id }),
  );

  /*
   * No row means the guard above rejected it — the order moved under us, or it
   * was never a rail that takes a reference. Reporting `ok` there told the
   * buyer their reference was recorded when it had been discarded, and left
   * the seller with nothing to reconcile against.
   */
  if (!updated) {
    return { ok: false, error: "This order is no longer awaiting a transfer." };
  }

  revalidatePath("/admin/orders");
  return { ok: true };
}
