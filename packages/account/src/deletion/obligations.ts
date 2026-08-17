/**
 * The one thing that refuses a deletion.
 *
 * Its own file because it is asked twice — once by the screen, to warn before the
 * seller commits, and once by the deletion itself, to refuse. A second definition of
 * "open obligation" is how a shop gets warned about one thing and blocked by another.
 */

import "server-only";
import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders } from "@sailo/db/schema";

export type Obligations = {
  blocked: boolean;
  /** How many paid-but-undelivered orders are standing in the way. */
  count: number;
};

/**
 * Paid orders the seller still owes something on.
 *
 * Deleting mid-obligation is seller fraud tooling: take the money, delete the
 * shop, and the buyer has an invoice and no goods. So an open paid order is a
 * hard refusal, not a warning — fulfil or refund first.
 *
 * "Open" is deliberately narrow. Only `new` and `confirmed` count: `shipped`
 * has left the building, `completed` is done, and `cancelled`/`refunded` are
 * settled in the buyer's favour. And only *paid* orders count — an unpaid
 * cash-on-delivery order that never happened must not trap someone in an
 * account forever.
 */
export async function openObligations(shopId: string): Promise<Obligations> {
  const rows = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.shopId, shopId),
        eq(orders.paymentStatus, "paid"),
        inArray(orders.status, ["new", "confirmed"]),
        or(
          // A booking whose time has not come yet — the buyer is expecting
          // someone to turn up.
          and(isNotNull(orders.scheduledFor), gt(orders.scheduledFor, new Date())),
          // A physical order that has not shipped.
          and(eq(orders.productKind, "physical"), isNull(orders.shippedAt)),
        ),
      ),
    );

  const count = rows[0]?.count ?? 0;
  return { blocked: count > 0, count };
}
