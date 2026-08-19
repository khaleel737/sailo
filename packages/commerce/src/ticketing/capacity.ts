import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  eventSessions,
  eventTiers,
  products,
  type EventSession,
  type EventTier,
} from "@sailo/db/schema";
import { reserveStock, releaseStock } from "../catalog/inventory";

/**
 * Two-level event capacity — spec 50, and the riskiest arithmetic in the wave.
 *
 * A room of 200 with 30 VIP seats is a product stock of 200 **and** a tier
 * capacity of 30. Both have to hold. Get it wrong and thirty-one people arrive
 * holding a VIP ticket for thirty seats, which is the one failure an event
 * seller cannot forgive — and it is invisible until the night.
 *
 * THREE RULES, EACH OF WHICH FAILS DIFFERENTLY
 *
 * 1. **Every level is a conditional UPDATE with its ceiling in the WHERE.**
 *    `set sold = sold + n where capacity is null or sold + n <= capacity`.
 *    Never a count followed by a write: `PRODUCTION-PLAN.md`'s concurrent
 *    double-booking defect was exactly that shape, and it was only ever found
 *    by a scenario test.
 *
 * 2. **The narrower level goes first.** Tier, then product. Taking the product
 *    first and the tier second oversells the tier while the product still
 *    looks available — the buyer is told yes by the wide check and refused by
 *    the narrow one, and in the window between them somebody else has taken
 *    the seat the first check reserved.
 *
 * 3. **All levels or none.** If the second claim fails, the first is given
 *    back before anything else happens. This is `claimSlots`'s shape and for
 *    the same reason: a partial claim is not a smaller order, it is capacity
 *    held by an order that will not exist.
 *
 * WHY NOT ONE TRANSACTION
 *
 * Because this driver cannot open one. `db.transaction()` throws on
 * neon-http — the note in `createOrderIntent` says so — and `db.batch()` is
 * non-interactive, so it cannot decide whether to run the second statement
 * based on the first's answer. Compensation is what is available, and it is
 * sound here because each level's claim is itself atomic: the only state a
 * crash between them can leave is capacity held by nothing, which the
 * abandoned-checkout sweep already returns.
 */

export type EventCapacityClaim = {
  productId: string;
  /** Which price band, if the event has any. */
  tierId: string | null;
  /** Which date, under `sessionMode: "pick_one"`. */
  sessionId: string | null;
  quantity: number;
  /** Whether the product itself counts units at all. */
  trackInventory: boolean;
  /**
   * True for an `all_access` pass, which admits every session and therefore
   * claims the *product's* stock rather than any one session's. Naming a
   * session on one of those would take a seat the pass does not occupy.
   */
  allAccess?: boolean;
};

/**
 * Takes one line's seats at every level it has, or none of them.
 *
 * Returns which level refused, so the buyer is told something they can act on:
 * "VIP is sold out" and "this event is sold out" are different sentences and a
 * seller loses a sale to the wrong one.
 */
export type CapacityResult =
  | { ok: true }
  | { ok: false; level: "tier" | "session" | "product" };

export async function claimEventCapacity(
  claim: EventCapacityClaim,
): Promise<CapacityResult> {
  if (claim.quantity <= 0) return { ok: true };

  /* --- 1. The tier, because it is the narrowest ------------------------- */
  if (claim.tierId) {
    const took = await claimTier(claim.tierId, claim.quantity);
    if (!took) return { ok: false, level: "tier" };
  }

  /* --- 2. The session, under `pick_one` --------------------------------- */
  if (claim.sessionId && !claim.allAccess) {
    const took = await claimSession(claim.sessionId, claim.quantity);
    if (!took) {
      // Give the tier back before answering. A refused checkout must leave no
      // seat held by an order that will not exist.
      if (claim.tierId) await releaseTier(claim.tierId, claim.quantity);
      return { ok: false, level: "session" };
    }
  }

  /* --- 3. The product's own stock, which is the room ---------------------- */
  const took = await reserveStock({
    productId: claim.productId,
    variantId: null,
    quantity: claim.quantity,
    trackInventory: claim.trackInventory,
  });
  if (!took) {
    if (claim.sessionId && !claim.allAccess) {
      await releaseSession(claim.sessionId, claim.quantity);
    }
    if (claim.tierId) await releaseTier(claim.tierId, claim.quantity);
    return { ok: false, level: "product" };
  }

  return { ok: true };
}

/** Gives every level back — a cancelled order, a self-cancelled seat. */
export async function releaseEventCapacity(
  claim: EventCapacityClaim,
): Promise<void> {
  if (claim.quantity <= 0) return;

  if (claim.tierId) await releaseTier(claim.tierId, claim.quantity);
  if (claim.sessionId && !claim.allAccess) {
    await releaseSession(claim.sessionId, claim.quantity);
  }
  await releaseStock({
    productId: claim.productId,
    variantId: null,
    quantity: claim.quantity,
  });
}

/**
 * One tier's seats, claimed conditionally.
 *
 * `capacity is null` is "share the product's stock", which is a tier that
 * exists to name a price rather than to ration anything — so it always
 * succeeds here and the product-level claim is what actually bounds it.
 */
async function claimTier(tierId: string, quantity: number): Promise<boolean> {
  const rows = await getDb()
    .update(eventTiers)
    .set({ sold: sql`${eventTiers.sold} + ${quantity}`, updatedAt: new Date() })
    .where(
      and(
        eq(eventTiers.id, tierId),
        sql`(${eventTiers.capacity} is null or ${eventTiers.sold} + ${quantity} <= ${eventTiers.capacity})`,
      ),
    )
    .returning({ id: eventTiers.id });
  return rows.length > 0;
}

/**
 * And back.
 *
 * `greatest(…, 0)` so a double release cannot push the counter negative, which
 * `sold + n <= capacity` would then read as room that does not exist.
 */
async function releaseTier(tierId: string, quantity: number): Promise<void> {
  await getDb()
    .update(eventTiers)
    .set({
      sold: sql`greatest(${eventTiers.sold} - ${quantity}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(eventTiers.id, tierId));
}

async function claimSession(sessionId: string, quantity: number): Promise<boolean> {
  const rows = await getDb()
    .update(eventSessions)
    .set({
      sold: sql`${eventSessions.sold} + ${quantity}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(eventSessions.id, sessionId),
        // A cancelled session sells nothing, whatever its capacity says.
        eq(eventSessions.isCancelled, false),
        sql`(${eventSessions.capacity} is null or ${eventSessions.sold} + ${quantity} <= ${eventSessions.capacity})`,
      ),
    )
    .returning({ id: eventSessions.id });
  return rows.length > 0;
}

async function releaseSession(sessionId: string, quantity: number): Promise<void> {
  await getDb()
    .update(eventSessions)
    .set({
      sold: sql`greatest(${eventSessions.sold} - ${quantity}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(eventSessions.id, sessionId));
}

/* -------------------------------------------------------------------------- */
/*  Reading                                                                   */
/* -------------------------------------------------------------------------- */

/** The bands a buyer may choose from, in the seller's order. */
export async function tiersFor(productId: string): Promise<EventTier[]> {
  return getDb().query.eventTiers.findMany({
    where: eq(eventTiers.productId, productId),
    orderBy: [asc(eventTiers.position), asc(eventTiers.createdAt)],
  });
}

/** The dates, soonest first. Cancelled ones included — the buyer is told. */
export async function sessionsFor(productId: string): Promise<EventSession[]> {
  return getDb().query.eventSessions.findMany({
    where: eq(eventSessions.productId, productId),
    orderBy: [asc(eventSessions.startsAt)],
  });
}

/** Seats left in a band, or null when it shares the product's stock. */
export function tierSeatsLeft(tier: Pick<EventTier, "capacity" | "sold">): number | null {
  if (tier.capacity === null) return null;
  return Math.max(0, tier.capacity - tier.sold);
}

export function sessionSeatsLeft(
  session: Pick<EventSession, "capacity" | "sold">,
): number | null {
  if (session.capacity === null) return null;
  return Math.max(0, session.capacity - session.sold);
}

/**
 * Writes `count` sessions at a fixed interval — the "generate weekly for 8
 * weeks" button, and the whole of recurrence in spec 50.
 *
 * **Deliberately not a recurrence rule.** No RRULE, no infinite series, no
 * stored pattern. Eight rows the seller can then edit individually is a shape
 * that never has to answer "what does editing the series do to the one you
 * have already sold tickets for" — which is the question every recurrence
 * engine eventually gets wrong in front of a customer.
 */
export async function generateSessions(input: {
  productId: string;
  startsAt: Date;
  endsAt: Date | null;
  everyDays: number;
  count: number;
  capacity: number | null;
}): Promise<number> {
  const count = Math.max(1, Math.min(52, Math.trunc(input.count)));
  const every = Math.max(1, Math.trunc(input.everyDays));
  const lengthMs = input.endsAt
    ? Math.max(0, input.endsAt.getTime() - input.startsAt.getTime())
    : null;

  const rows = Array.from({ length: count }, (_, i) => {
    const startsAt = new Date(input.startsAt.getTime() + i * every * 86_400_000);
    return {
      productId: input.productId,
      startsAt,
      endsAt: lengthMs === null ? null : new Date(startsAt.getTime() + lengthMs),
      capacity: input.capacity,
      position: i,
    };
  });

  const written = await getDb()
    .insert(eventSessions)
    .values(rows)
    .returning({ id: eventSessions.id });
  return written.length;
}

/**
 * The claim on telling a cancelled session's ticket-holders.
 *
 * A bulk send wearing a product feature's clothes — it goes through the
 * broadcast quota and the suppression list, exactly as spec 33's waitlist
 * notify does — so two cron ticks send it once between them.
 */
export async function claimSessionCancelNotice(
  sessionId: string,
): Promise<boolean> {
  const [claimed] = await getDb()
    .update(eventSessions)
    .set({ cancelNotifiedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(eventSessions.id, sessionId),
        eq(eventSessions.isCancelled, true),
        isNull(eventSessions.cancelNotifiedAt),
      ),
    )
    .returning({ id: eventSessions.id });
  return Boolean(claimed);
}

/**
 * Whether an event still has a date in the future to sell.
 *
 * Sales close at `eventStartsAt` today; with sessions that becomes per
 * session, and a `pick_one` product whose last session has passed is
 * unavailable — which is spec 33's waitlist trigger rather than a 404.
 */
export async function eventHasFutureDate(
  product: Pick<
    typeof products.$inferSelect,
    "id" | "eventStartsAt" | "sessionMode"
  >,
  now = new Date(),
): Promise<boolean> {
  if (!product.sessionMode) {
    return !product.eventStartsAt || product.eventStartsAt.getTime() > now.getTime();
  }

  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(eventSessions)
    .where(
      and(
        eq(eventSessions.productId, product.id),
        eq(eventSessions.isCancelled, false),
        sql`${eventSessions.startsAt} > ${now}`,
      ),
    );
  return (row?.n ?? 0) > 0;
}
