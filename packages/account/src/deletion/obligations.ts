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
import { disputes, orders, shops } from "@sailo/db/schema";

export type Obligations = {
  blocked: boolean;
  /** How many paid-but-undelivered orders are standing in the way. */
  count: number;
  /**
   * Open card disputes standing in the way, counted separately because the two
   * are answered by different actions: an undelivered order is fixed by
   * shipping or refunding it, and a dispute is fixed by waiting for the network
   * to decide. Reporting them as one number would produce a screen that tells a
   * seller to fulfil four orders when three of them do not exist.
   */
  openDisputes: number;
  /** Whether a staff payout hold is standing in the way. */
  payoutsHeld: boolean;
};

/**
 * What the seller still owes somebody, and what somebody still owes an answer on.
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
 *
 * ─── THE TWO THIS DID NOT COVER, AND WHY THEY ARE HERE NOW ───────────────────
 * The order test above has one shape of fraud in mind — physical goods and
 * bookings — and both of its branches are about *delivery*. A seller of digital
 * downloads passes it trivially: the file is delivered at checkout, the order
 * goes straight to `completed`, and the account could be deleted with forty
 * chargebacks live against it. That is the cheapest fraud on this platform to
 * commit and it was the one deletion did not refuse.
 *
 *   - **Open disputes.** `needs_response` and `under_review` mean a card network
 *     has a live case, and answering it needs the evidence that this deletion is
 *     about to erase — the order, the product, the buyer's address, the download
 *     log. Deleting mid-dispute does not make the dispute go away; it makes it
 *     unanswerable, and an unanswered dispute is lost by default, at Sailo's
 *     expense once the connected account's balance runs out.
 *
 *   - **A payout hold.** Somebody, or the dispute ladder, deliberately stopped
 *     money leaving this account. Deleting the shop disconnects the Stripe
 *     account, which is precisely the thing the hold exists to prevent
 *     happening quietly.
 *
 * Both are finite and both are visible to the seller, which is what keeps this a
 * refusal rather than a trap: a dispute resolves within the network's own
 * deadline, and a hold is released by the same desk that set it. Neither can be
 * outlasted by waiting, and neither leaves an honest seller unable to leave.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function openObligations(shopId: string): Promise<Obligations> {
  const db = getDb();

  const [orderRows, disputeRows, shopRow] = await Promise.all([
    db
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
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(disputes)
      .where(
        and(
          eq(disputes.shopId, shopId),
          inArray(disputes.status, ["needs_response", "under_review"]),
        ),
      ),

    db.query.shops.findFirst({
      where: eq(shops.id, shopId),
      columns: { payoutsPausedAt: true },
    }),
  ]);

  const count = orderRows[0]?.count ?? 0;
  const openDisputes = disputeRows[0]?.count ?? 0;
  const payoutsHeld = Boolean(shopRow?.payoutsPausedAt);

  return {
    blocked: count > 0 || openDisputes > 0 || payoutsHeld,
    count,
    openDisputes,
    payoutsHeld,
  };
}
