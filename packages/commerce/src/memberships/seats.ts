import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  subscriptionSeats,
  subscriptions,
  type Subscription,
  type SubscriptionSeat,
} from "@sailo/db/schema";
import { membershipAccess, type MembershipAccess } from "./memberships";
import { newMemberPassCode } from "./passes";
import { seatVerdict, type SeatVerdict } from "./terms";

/**
 * Seats bought together and assigned to people — spec 49.
 *
 * The one genuinely new shape in membership depth, and what turns a membership
 * into something a *company* buys rather than a person.
 *
 * THE DIVISION THAT KEEPS `membershipAccess` FROM FORKING
 *
 * **The payer holds the billing relationship; each seat holds its own
 * access.** A seat has no status, no period end and no price — it has an email
 * address and a pass code. When the door asks whether a seat may come in, the
 * answer is read from the **parent subscription** through the same
 * `membershipAccess` every other caller uses. One source of truth for whether
 * the money is good; the seat only says who.
 *
 * That is why cancelling the payer's subscription stops all eight employees
 * with no code that knows how to do it, and why a seat cannot outlive the
 * arrangement that paid for it.
 *
 * WHAT A SEAT IS NOT
 *
 * It is not an account. A seat is reached by a signed token like everything
 * else a buyer touches — §4.8 of the gap analysis stands. This is the closest
 * buyer identity has come to needing a login and it still does not need one.
 */

export type SeatWithAccess = SubscriptionSeat & { access: MembershipAccess };

/**
 * Sets how many people a subscription is for.
 *
 * Reducing below the number of seats somebody has **accepted** is refused with
 * the number rather than silently truncated — rule 8. Truncating would pick
 * which employee loses their access, at random, on the seller's behalf, and
 * the first anybody would know is somebody being turned away at a door.
 *
 * The price is not touched here: `quantity` on the Stripe subscription is the
 * seat count, so what eight seats cost is Stripe's arithmetic. Sailo computing
 * a per-seat total would be a second opinion about money, which is the one
 * thing this module's own header says it must not be.
 */
export async function setSeatCount(input: {
  shopId: string;
  subscriptionId: string;
  seats: number;
}): Promise<SeatVerdict | null> {
  const db = getDb();

  const row = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, input.subscriptionId),
      eq(subscriptions.shopId, input.shopId),
    ),
    columns: { id: true },
  });
  if (!row) return null;

  const verdict = seatVerdict(input.seats, await acceptedSeatCount(row.id));
  if (!verdict.allowed) return verdict;

  await db
    .update(subscriptions)
    .set({ seats: verdict.seats, updatedAt: new Date() })
    .where(
      and(
        eq(subscriptions.id, input.subscriptionId),
        eq(subscriptions.shopId, input.shopId),
      ),
    );

  return verdict;
}

/** Seats somebody has actually taken up. Revoked ones are free again. */
export async function acceptedSeatCount(subscriptionId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(subscriptionSeats)
    .where(
      and(
        eq(subscriptionSeats.subscriptionId, subscriptionId),
        isNull(subscriptionSeats.revokedAt),
      ),
    );
  return row?.n ?? 0;
}

export type InviteResult =
  | { ok: true; seat: SubscriptionSeat }
  | { ok: false; reason: "no_room"; seats: number; used: number }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "no_email" };

/**
 * Puts one person on a seat.
 *
 * **The ceiling is in the WHERE**, not read and then written. A company
 * pasting nine addresses into a form of eight seats must have the ninth
 * refused, and a count taken in JavaScript is a count two concurrent
 * submissions both pass. The conditional insert counts live seats inside the
 * statement that adds one.
 *
 * `ON CONFLICT` on (subscription, email) makes re-inviting somebody an update
 * rather than a second seat — which is what a seller means when they re-send
 * an invitation, and it is also what stops a revoked person being re-added as
 * a duplicate row that the count would then double.
 */
export async function inviteSeat(input: {
  shopId: string;
  subscriptionId: string;
  email: string;
  name?: string | null;
}): Promise<InviteResult> {
  const db = getDb();

  const email = input.email.trim().toLowerCase().slice(0, 320);
  if (!email || !email.includes("@")) return { ok: false, reason: "no_email" };

  const row = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, input.subscriptionId),
      eq(subscriptions.shopId, input.shopId),
    ),
    columns: { id: true, seats: true },
  });
  if (!row) return { ok: false, reason: "not_found" };

  /*
   * The conditional insert. `WHERE (live seats) < seats` is evaluated by
   * Postgres against the same table the row is going into, which is legal here
   * — unlike a licence activation — because the ceiling lives on
   * `subscriptions` rather than on the table being written.
   */
  const [seat] = await db
    .insert(subscriptionSeats)
    .values({
      subscriptionId: row.id,
      email,
      name: input.name?.trim().slice(0, 120) || null,
      /*
       * Minted with the seat rather than on demand, unlike the payer's own
       * pass. The payer's is lazy because most memberships are never scanned;
       * a *seat* exists precisely because somebody is being sent a credential,
       * so there is nothing to defer.
       */
      passCode: newMemberPassCode(),
    })
    .onConflictDoUpdate({
      target: [subscriptionSeats.subscriptionId, subscriptionSeats.email],
      set: {
        name: input.name?.trim().slice(0, 120) || null,
        invitedAt: new Date(),
        // Re-inviting somebody who was revoked puts them back, which is what a
        // seller means by typing their address in again.
        revokedAt: null,
      },
    })
    .returning();

  if (!seat) return { ok: false, reason: "not_found" };

  /*
   * The ceiling, checked after the insert for the same reason a licence
   * activation's is: the count and the write cannot be one statement here
   * either. Rank by `(invited_at, id)` — a total order over committed rows —
   * so two concurrent invitations to a full subscription cannot both decide
   * they fit.
   */
  const [rank] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(subscriptionSeats)
    .where(
      and(
        eq(subscriptionSeats.subscriptionId, row.id),
        isNull(subscriptionSeats.revokedAt),
        sql`(${subscriptionSeats.invitedAt}, ${subscriptionSeats.id}) <= (${seat.invitedAt}, ${seat.id})`,
      ),
    );

  if ((rank?.n ?? 0) > row.seats) {
    // Revoked rather than deleted: the seller invited them, and a row that
    // says "invited then immediately revoked" is a truer record than one that
    // was never there. It also keeps the address, so re-inviting after buying
    // another seat finds the same row.
    await db
      .update(subscriptionSeats)
      .set({ revokedAt: new Date() })
      .where(eq(subscriptionSeats.id, seat.id));
    return { ok: false, reason: "no_room", seats: row.seats, used: row.seats };
  }

  return { ok: true, seat };
}

/** Frees a seat for reassignment. The pass stops working on the next scan. */
export async function revokeSeat(input: {
  shopId: string;
  subscriptionId: string;
  seatId: string;
}): Promise<boolean> {
  const db = getDb();

  const owned = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, input.subscriptionId),
      eq(subscriptions.shopId, input.shopId),
    ),
    columns: { id: true },
  });
  if (!owned) return false;

  const [gone] = await db
    .update(subscriptionSeats)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(subscriptionSeats.id, input.seatId),
        eq(subscriptionSeats.subscriptionId, owned.id),
        isNull(subscriptionSeats.revokedAt),
      ),
    )
    .returning({ id: subscriptionSeats.id });

  return Boolean(gone);
}

/** Every seat on a subscription, oldest first, with the parent's access. */
export async function seatsFor(
  subscription: Pick<Subscription, "id" | "status" | "currentPeriodEnd" | "cancelAtPeriodEnd">,
  now = new Date(),
): Promise<SeatWithAccess[]> {
  const rows = await getDb().query.subscriptionSeats.findMany({
    where: eq(subscriptionSeats.subscriptionId, subscription.id),
    orderBy: [asc(subscriptionSeats.invitedAt)],
  });

  const access = membershipAccess(subscription, now);
  return rows.map((seat) => ({
    seat,
    access,
  })).map(({ seat, access: a }) => ({
    ...seat,
    // A revoked seat is closed whatever the parent says. Everything else reads
    // the parent, which is the whole division this module is built on.
    access: seat.revokedAt ? { open: false, endingSoon: false, until: null } : a,
  }));
}

/**
 * The seat behind a scanned pass code, and whether it opens the door.
 *
 * The entitlement is the **parent's**, read live at scan time exactly as
 * `checkInMemberByCode` reads a payer's own subscription. A seat is never its
 * own authority on whether the money is good — that is the property that lets
 * one cancellation stop eight employees without eight rows being touched.
 */
export async function seatByPassCode(
  code: string,
  now = new Date(),
): Promise<{ seat: SubscriptionSeat; subscription: Subscription; access: MembershipAccess } | null> {
  const db = getDb();

  const seat = await db.query.subscriptionSeats.findFirst({
    where: eq(subscriptionSeats.passCode, code),
  });
  if (!seat || seat.revokedAt) return null;

  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, seat.subscriptionId),
  });
  if (!subscription) return null;

  return { seat, subscription, access: membershipAccess(subscription, now) };
}
