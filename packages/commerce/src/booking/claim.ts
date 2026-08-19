import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { bookingClaims, bookingSlots, orderItems, products } from "@sailo/db/schema";

/**
 * Taking an appointment, and giving it back.
 *
 * `busyFor` decides which times a shop *may* offer. That decision is a read
 * and nothing more, so two buyers asking for the same slot in the same second
 * both see it free and both pass the re-derivation at checkout — and the shop
 * owes one appointment to two people, with nothing anywhere to notice.
 *
 * Claiming is the separate act of taking it, and **the exclusion constraint is
 * what actually enforces exclusivity**. The same shape `reserveStock` and
 * `claimCouponRedemption` already have, for the same reason: a check followed
 * by a write is two statements with a gap, and the gap is exactly wide enough
 * for the second buyer.
 *
 * ─── WHAT CHANGED IN SPEC 51, AND WHY IT IS THE RISKIEST LINE IN THE WAVE ───
 *
 * `booking_claims_no_overlap` used to key on `(product_id, range)`. It now
 * keys on `(COALESCE(staff_id, product_id), range)`, partial on
 * `is_exclusive`. Three consequences, and every one of them is load-bearing:
 *
 *   * **A shop with no staff behaves exactly as before.** `staff_id` is null,
 *     so the key is `product_id` and the constraint is byte-for-byte `0004`'s.
 *     `COALESCE` is not a nicety here: keying on `staff_id` alone would have
 *     excluded *nothing* for every existing shop, because Postgres treats
 *     `NULL = NULL` as unknown — and the failure would be a double-booked
 *     Saturday rather than an error.
 *   * **Two stylists can work at once, and neither can be booked twice.**
 *     Across different services too, which the product-keyed version never
 *     caught: one hairdresser could be booked for a cut *and* a colour at
 *     10:00 because the two claims named different products.
 *   * **`ON CONFLICT DO NOTHING` no longer works.** An exclusion constraint
 *     cannot be inferred by `ON CONFLICT`, and `booking_claims_slot_key` — the
 *     unique index it used to infer — had to go, because `(product_id,
 *     starts_at)` is now *wrong*: two stylists on the same slot of the same
 *     service are two legitimate rows. So a taken slot arrives as an error
 *     rather than as an empty result, and `claimSlots` catches it. Same
 *     answer, different shape.
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
  /**
   * Which person — spec 51. Null is "any available", which is today.
   *
   * A null here is not "nobody": it is the key the constraint falls back to
   * `productId` for, which is exactly the guarantee a shop without staff has
   * always had.
   */
  staffId?: string | null;
  /**
   * Seats this claim takes out of a class — spec 51. One is an appointment.
   *
   * Anything above one makes the claim non-exclusive, because twelve people in
   * a yoga class is twelve overlapping rows and an exclusion constraint would
   * refuse the second of them.
   */
  seats?: number;
  /**
   * How many the class holds. Null or one is a one-to-one appointment, which
   * takes the exclusion constraint's path; anything higher takes the capacity
   * claim's.
   */
  capacity?: number | null;
};

/** Whether this slot is owned outright or shared with other buyers. */
function exclusive(slot: SlotClaim): boolean {
  return (slot.capacity ?? 1) <= 1;
}

/**
 * Takes every slot in one basket, or none of them.
 *
 * All-or-nothing because a partial booking is not a smaller order — it is an
 * order the buyer did not ask for. If the second of two appointments is gone,
 * the first is released and the whole checkout is refused, which is the answer
 * the buyer can act on.
 */
export async function claimSlots(
  orderId: string,
  slots: SlotClaim[],
): Promise<boolean> {
  if (slots.length === 0) return true;

  for (const slot of slots) {
    const took = exclusive(slot)
      ? await claimExclusive(orderId, slot)
      : await claimSeat(orderId, slot);

    if (!took) {
      // Someone got there first. Give back whatever this attempt did take, so
      // a refused checkout leaves no slot held by an order that will not exist.
      await releaseSlots(orderId);
      return false;
    }
  }
  return true;
}

/**
 * One appointment, owned outright.
 *
 * The insert is unconditional and the **database refuses it** — the exclusion
 * constraint compares ranges rather than equality, which is the whole reason
 * it exists. A `23P01` is the ordinary outcome this is written to produce, not
 * a broken invariant, so it comes back as `false` rather than throwing into a
 * checkout.
 *
 * Anything that is *not* an exclusion violation is re-thrown. Swallowing every
 * error here would turn a connection failure into "that slot is taken", which
 * is a lie the buyer would act on by picking another time that also fails.
 */
async function claimExclusive(orderId: string, slot: SlotClaim): Promise<boolean> {
  try {
    await getDb()
      .insert(bookingClaims)
      .values({
        orderId,
        productId: slot.productId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        staffId: slot.staffId ?? null,
        seatsTaken: 1,
        isExclusive: true,
      });
    return true;
  } catch (error) {
    if (isOverlapViolation(error)) return false;
    throw error;
  }
}

/**
 * `23P01` — `exclusion_violation`. The one error code that means "taken".
 *
 * Matched on the **code**, not on the message: the message carries the
 * constraint name and the table name, and both are things a later migration
 * renames. `23505` is accepted too — a unique violation on this table can only
 * come from a claim racing itself, which is the same answer to the caller.
 *
 * The cause chain has to be walked rather than the top-level object read,
 * because two layers wrap it before it gets here: drizzle raises a
 * `DrizzleQueryError` whose `cause` is the driver's error, and the neon-http
 * driver's own `NeonDbError` carries `sourceError` under that. Reading only
 * the outermost `code` finds `undefined`, and the exclusion violation — the
 * ordinary "that slot is taken" — escapes into the checkout as a crash.
 *
 * Bounded rather than `while (true)`, because a cyclic `cause` is a thing that
 * happens and an infinite loop inside a checkout is worse than a missed match.
 */
function isOverlapViolation(error: unknown): boolean {
  let node: unknown = error;
  for (let depth = 0; depth < 6 && node; depth += 1) {
    const code = (node as { code?: unknown }).code;
    if (code === "23P01" || code === "23505") return true;
    node =
      (node as { sourceError?: unknown }).sourceError ??
      (node as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * One seat in a class — spec 51.
 *
 * ─── WHY THIS IS NOT A CONDITIONAL INSERT, THOUGH IT LOOKS LIKE ONE ─────────
 *
 * The obvious shape is `INSERT … SELECT … WHERE (SELECT sum(seats_taken) …) +
 * $n <= $capacity`, and it is **wrong under contention**. It was written that
 * way first and the scenario caught it: twelve buyers arriving at a ten-seat
 * class produced eleven bookings.
 *
 * The reason is snapshots rather than sloppiness. Under READ COMMITTED every
 * statement takes its snapshot at statement start, so a subquery counting
 * `booking_claims` cannot see rows other transactions have not committed yet —
 * all twelve read the same sum and eleven pass a ceiling that should have
 * stopped ten. Neither a `FOR UPDATE` on the product nor an advisory lock fixes
 * it: both are acquired *after* the snapshot and neither advances it. Ranking
 * the committed rows afterwards fails the same way in the other direction — a
 * caller whose rank query runs before its siblings commit ranks itself too low.
 *
 * The one shape Postgres does make atomic is a **conditional UPDATE on the row
 * that holds the count**: it re-reads that row under its own lock and
 * re-evaluates the WHERE against the latest committed version. That is exactly
 * why `reserveStock` is safe, and `products.stock_quantity` is that row for a
 * product. A class has a capacity per *slot*, so it gets a row per slot —
 * `booking_slots`, and nothing more.
 *
 * The per-order `booking_claims` row is still written, because releasing has to
 * be idempotent and per-order: the delete returns what it actually removed and
 * only that many seats go back.
 */
async function claimSeat(orderId: string, slot: SlotClaim): Promise<boolean> {
  const db = getDb();
  const seats = Math.max(1, Math.trunc(slot.seats ?? 1));
  const capacity = Math.max(1, Math.trunc(slot.capacity ?? 1));

  /*
   * The counter row, created if this is the first booking for the slot.
   * `onConflictDoNothing` rather than a prior read: two buyers arriving at an
   * empty class both try, one writes, and both go on to the UPDATE that
   * actually decides.
   */
  await db
    .insert(bookingSlots)
    .values({
      productId: slot.productId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      seatsTaken: 0,
    })
    .onConflictDoNothing();

  const [taken] = await db
    .update(bookingSlots)
    .set({ seatsTaken: sql`${bookingSlots.seatsTaken} + ${seats}` })
    .where(
      and(
        eq(bookingSlots.productId, slot.productId),
        eq(bookingSlots.startsAt, slot.startsAt),
        // The ceiling, in the WHERE. A party of three against ten with eight
        // gone is refused whole rather than seated in part.
        sql`${bookingSlots.seatsTaken} + ${seats} <= ${capacity}`,
      ),
    )
    .returning({ id: bookingSlots.id });
  if (!taken) return false;

  /*
   * The per-order record, written after the seats are held. A failure here
   * would leave seats claimed by nothing, which the abandoned-checkout sweep
   * returns — the same direction every claim in this codebase fails in.
   */
  await db.insert(bookingClaims).values({
    orderId,
    productId: slot.productId,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    staffId: slot.staffId ?? null,
    seatsTaken: seats,
    isExclusive: false,
  });

  return true;
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
  const db = getDb();

  /*
   * Deleting by order is what makes this idempotent — a second call finds
   * nothing and removes nothing, which is what lets the sweep race a webhook.
   * The `RETURNING` is what makes it *correct* for a class: seats go back
   * according to what was actually removed, so a double release gives back one
   * set of seats rather than two.
   */
  const gone = await db
    .delete(bookingClaims)
    .where(eq(bookingClaims.orderId, orderId))
    .returning({
      productId: bookingClaims.productId,
      startsAt: bookingClaims.startsAt,
      seatsTaken: bookingClaims.seatsTaken,
      isExclusive: bookingClaims.isExclusive,
    });

  for (const row of gone) {
    if (row.isExclusive) continue;
    await giveSeatsBack(row.productId, row.startsAt, row.seatsTaken);
  }
}

/**
 * Puts class seats back on the counter.
 *
 * `greatest(…, 0)` so a release that somehow ran twice cannot push the counter
 * negative — a negative count reads as room that does not exist the next time
 * somebody books.
 */
async function giveSeatsBack(
  productId: string,
  startsAt: Date,
  seats: number,
): Promise<void> {
  await getDb()
    .update(bookingSlots)
    .set({ seatsTaken: sql`greatest(${bookingSlots.seatsTaken} - ${seats}, 0)` })
    .where(
      and(
        eq(bookingSlots.productId, productId),
        eq(bookingSlots.startsAt, startsAt),
      ),
    );
}

/** Releases one line's slot, for a buyer moving or cancelling a single item. */
export async function releaseSlot(
  orderId: string,
  productId: string,
  startsAt: Date,
): Promise<void> {
  const gone = await getDb()
    .delete(bookingClaims)
    .where(
      and(
        eq(bookingClaims.orderId, orderId),
        eq(bookingClaims.productId, productId),
        eq(bookingClaims.startsAt, startsAt),
      ),
    )
    .returning({
      seatsTaken: bookingClaims.seatsTaken,
      isExclusive: bookingClaims.isExclusive,
    });

  for (const row of gone) {
    if (row.isExclusive) continue;
    await giveSeatsBack(productId, startsAt, row.seatsTaken);
  }
}

/** The end of an appointment, from its start and the product's duration. */
export function slotEnd(startsAt: Date, durationMinutes: number | null): Date {
  return new Date(startsAt.getTime() + Math.max(0, durationMinutes ?? 0) * 60_000);
}

/**
 * Re-claims an order's appointments after a seller un-cancels it.
 *
 * Best effort, and the asymmetry with `claimSlots` is deliberate. At checkout a
 * lost slot means refusing the order, because the buyer is still there and can
 * pick another. Here the order already existed and the seller is undoing their
 * own cancellation — so a slot that someone else has taken in the meantime is a
 * scheduling conflict for them to resolve, not a reason to refuse the reversal
 * and leave them with an order they cannot reinstate.
 *
 * Returns how many were reclaimed, so a caller that wants to warn can.
 */
export async function retakeSlots(order: { id: string }): Promise<number> {
  const db = getDb();

  const lines = await db
    .select({
      productId: orderItems.productId,
      scheduledFor: orderItems.scheduledFor,
      staffId: orderItems.staffId,
      quantity: orderItems.quantity,
      // The product's length, so the range this re-claims is the one it held.
      durationMinutes: products.durationMinutes,
      bookingCapacity: products.bookingCapacity,
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
            staffId: line.staffId,
            seats: line.quantity,
            capacity: line.bookingCapacity,
          } satisfies SlotClaim,
        ]
      : [],
  );
  if (slots.length === 0) return 0;

  let taken = 0;
  for (const slot of slots) {
    const ok = exclusive(slot)
      ? await claimExclusive(order.id, slot)
      : await claimSeat(order.id, slot);
    if (ok) taken += 1;
  }
  return taken;
}

/**
 * Moves one appointment, taking the new slot **before** releasing the old.
 *
 * That order is the whole of it. A buyer must never lose their slot to a
 * failure to get the new one — so the new time is claimed first, and only once
 * it is held does the old one go back. The cost is a moment where the order
 * holds two slots, which is strictly better than a moment where it holds none:
 * the first is invisible and self-corrects, the second is a buyer with no
 * appointment and a seller with a free slot somebody else can take.
 *
 * `false` means the new time was gone, and nothing moved.
 */
export async function rescheduleSlot(input: {
  orderId: string;
  productId: string;
  from: Date;
  to: Date;
  durationMinutes: number | null;
  staffId?: string | null;
  capacity?: number | null;
  seats?: number;
}): Promise<boolean> {
  const slot: SlotClaim = {
    productId: input.productId,
    startsAt: input.to,
    endsAt: slotEnd(input.to, input.durationMinutes),
    staffId: input.staffId ?? null,
    seats: input.seats ?? 1,
    capacity: input.capacity ?? null,
  };

  /*
   * The order's own existing claim would collide with itself if the new time
   * overlaps the old — moving an appointment forward by fifteen minutes is the
   * ordinary case. So the old row is excluded from the constraint the only way
   * an exclusion constraint allows: it is deleted first *when the two ranges
   * overlap*, and re-created if the new claim then fails.
   *
   * A non-overlapping move needs none of that and takes the safe order.
   */
  const oldEnd = slotEnd(input.from, input.durationMinutes);
  const overlaps =
    input.to.getTime() < oldEnd.getTime() &&
    slot.endsAt.getTime() > input.from.getTime();

  if (!overlaps) {
    const took = exclusive(slot)
      ? await claimExclusive(input.orderId, slot)
      : await claimSeat(input.orderId, slot);
    if (!took) return false;
    await releaseSlot(input.orderId, input.productId, input.from);
    return true;
  }

  await releaseSlot(input.orderId, input.productId, input.from);
  const took = exclusive(slot)
    ? await claimExclusive(input.orderId, slot)
    : await claimSeat(input.orderId, slot);
  if (took) return true;

  /*
   * Put the buyer back where they were. The old slot was theirs a millisecond
   * ago and the only thing that can have taken it in between is a concurrent
   * claim on the same range — in which case the reinstatement fails too and
   * the buyer has genuinely lost it, which is a fact rather than something
   * this function caused.
   */
  await claimExclusive(input.orderId, {
    productId: input.productId,
    startsAt: input.from,
    endsAt: oldEnd,
    staffId: input.staffId ?? null,
  });
  return false;
}

/**
 * Whether anybody else's appointment sits in a range, for one resource.
 *
 * A read, and therefore never the guard — the constraint is. This is what the
 * seller's day list and the reschedule screen ask so they can offer a time
 * that is likely to work, and `excludeOrderId` is what lets an order be moved
 * without clashing with itself.
 */
export async function rangeIsFree(input: {
  productId: string;
  staffId?: string | null;
  from: Date;
  to: Date;
  excludeOrderId?: string;
}): Promise<boolean> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(bookingClaims)
    .where(
      and(
        input.staffId
          ? eq(bookingClaims.staffId, input.staffId)
          : and(
              eq(bookingClaims.productId, input.productId),
              isNull(bookingClaims.staffId),
            ),
        eq(bookingClaims.isExclusive, true),
        sql`tsrange(${bookingClaims.startsAt}, greatest(${bookingClaims.endsAt}, ${bookingClaims.startsAt}), '[)') && tsrange(${input.from}, ${input.to}, '[)')`,
        ...(input.excludeOrderId
          ? [ne(bookingClaims.orderId, input.excludeOrderId)]
          : []),
      ),
    );
  return (row?.n ?? 0) === 0;
}
