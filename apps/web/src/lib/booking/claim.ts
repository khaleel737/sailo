import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { bookingClaims, orderItems, products } from "@/db/schema";

/**
 * Taking an appointment, and giving it back.
 *
 * `busyFor` decides which times a shop *may* offer. That decision is a read
 * and nothing more, so two buyers asking for the same slot in the same second
 * both see it free and both pass the re-derivation at checkout — and the shop
 * owes one appointment to two people, with nothing anywhere to notice.
 *
 * Claiming is the separate act of taking it, and the unique index on
 * `(product_id, starts_at)` is what actually enforces exclusivity. The same
 * shape `reserveStock` and `claimCouponRedemption` already have, for the same
 * reason: a check followed by a write is two statements with a gap, and the
 * gap is exactly wide enough for the second buyer.
 */

export type SlotClaim = {
  productId: string;
  startsAt: Date;
  /**
   * When the appointment ends. Carried because overlapping is what
   * double-booked means: a shop can offer a 60-minute service on the half
   * hour, so 09:00 and 09:30 are both offerable starts and comparing starts
   * alone would let two concurrent checkouts take both.
   */
  endsAt: Date;
};

/**
 * Takes every slot in one basket, or none of them.
 *
 * All-or-nothing because a partial booking is not a smaller order — it is an
 * order the buyer did not ask for. If the second of two appointments is gone,
 * the first is released and the whole checkout is refused, which is the answer
 * the buyer can act on.
 *
 * `onConflictDoNothing` rather than a prior read: the conflict *is* the
 * answer, and asking first would reintroduce the gap this exists to close.
 */
export async function claimSlots(
  orderId: string,
  slots: SlotClaim[],
): Promise<boolean> {
  if (slots.length === 0) return true;

  const taken = await getDb()
    .insert(bookingClaims)
    .values(slots.map((s) => ({ ...s, orderId })))
    .onConflictDoNothing()
    .returning({ id: bookingClaims.id });

  if (taken.length === slots.length) return true;

  // Someone got there first. Give back whatever this attempt did take, so a
  // refused checkout leaves no slot held by an order that will not exist.
  await releaseSlots(orderId);
  return false;
}

/**
 * Gives an order's appointments back.
 *
 * Called wherever an order stops owing its time — cancelled, refunded,
 * abandoned, or a checkout that failed after the claim. Deleting by order
 * makes it idempotent: a second call finds nothing and removes nothing, which
 * is what lets the sweep race a webhook safely.
 */
export async function releaseSlots(orderId: string): Promise<void> {
  await getDb().delete(bookingClaims).where(eq(bookingClaims.orderId, orderId));
}

/** The end of an appointment, from its start and the product's duration. */
export function slotEnd(startsAt: Date, durationMinutes: number | null): Date {
  return new Date(startsAt.getTime() + Math.max(0, durationMinutes ?? 0) * 60_000);
}

/**
 * Re-claims an order's appointments after a seller un-cancels it.
 *
 * Best effort, and the asymmetry with `claimSlots` is deliberate. At checkout
 * a lost slot means refusing the order, because the buyer is still there and
 * can pick another. Here the order already existed and the seller is undoing
 * their own cancellation — so a slot that someone else has taken in the
 * meantime is a scheduling conflict for them to resolve, not a reason to
 * refuse the reversal and leave them with an order they cannot reinstate.
 *
 * Returns how many were reclaimed, so a caller that wants to warn can.
 */
export async function retakeSlots(order: { id: string }): Promise<number> {
  const db = getDb();

  const lines = await db
    .select({
      productId: orderItems.productId,
      scheduledFor: orderItems.scheduledFor,
      // The product's length, so the range this re-claims is the one it held.
      durationMinutes: products.durationMinutes,
    })
    .from(orderItems)
    .leftJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, order.id));

  const slots = lines.flatMap((line) =>
    line.productId && line.scheduledFor
      ? [
          {
            productId: line.productId,
            startsAt: line.scheduledFor,
            endsAt: slotEnd(line.scheduledFor, line.durationMinutes),
          },
        ]
      : [],
  );
  if (slots.length === 0) return 0;

  const taken = await db
    .insert(bookingClaims)
    .values(slots.map((s) => ({ ...s, orderId: order.id })))
    .onConflictDoNothing()
    .returning({ id: bookingClaims.id });

  return taken.length;
}
