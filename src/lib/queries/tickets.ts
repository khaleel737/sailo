import "server-only";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, productVariants, products, tickets } from "@/db/schema";
import { normalizeTicketCode } from "@/lib/tickets";

/**
 * What the door needs to know, as opposed to what a single scan decides.
 *
 * The check-in decision lives in `lib/tickets.ts` and is a claim in a WHERE
 * clause. Everything here is a read: the list of events worth standing at,
 * the counters above the door, and the list a volunteer searches when a guest
 * turns up with a dead phone and a name.
 */

/* -------------------------------------------------------------------------- */
/*  Counters                                                                   */
/* -------------------------------------------------------------------------- */

export type DoorStats = {
  /** Admissions that exist and have not been revoked. */
  issued: number;
  checkedIn: number;
  /** Issued minus checked in — the queue still outside. */
  remaining: number;
  revoked: number;
  /**
   * Seats in the room: what has been issued plus what is still for sale.
   * Null when the event doesn't track inventory, which means uncapped.
   */
  capacity: number | null;
  /** Admissions the seller issued rather than sold — comps, walk-ups. */
  comped: number;
};

/**
 * The counters, in one round trip.
 *
 * `FILTER` rather than four queries: this is polled by every open door screen
 * on every check-in, and an event with three volunteers scanning is three
 * clients asking a few times a minute for the whole evening.
 */
export async function eventDoorStats(
  shopId: string,
  productId: string,
): Promise<DoorStats> {
  const db = getDb();

  const [counts, stock] = await Promise.all([
    db
      .select({
        issued: sql<number>`count(*) filter (where ${tickets.status} <> 'void')::int`,
        checkedIn: sql<number>`count(*) filter (where ${tickets.status} = 'used')::int`,
        revoked: sql<number>`count(*) filter (where ${tickets.status} = 'void')::int`,
        comped: sql<number>`count(*) filter (where ${tickets.source} <> 'order' and ${tickets.status} <> 'void')::int`,
      })
      .from(tickets)
      .where(and(eq(tickets.shopId, shopId), eq(tickets.productId, productId))),
    unsoldSeats(shopId, productId),
  ]);

  const row = counts[0] ?? { issued: 0, checkedIn: 0, revoked: 0, comped: 0 };

  return {
    issued: row.issued,
    checkedIn: row.checkedIn,
    remaining: Math.max(0, row.issued - row.checkedIn),
    revoked: row.revoked,
    comped: row.comped,
    // Stock has already been decremented by everything sold, so the room is
    // what is in hand plus what is still buyable. Null propagates: an event
    // that doesn't track inventory has no capacity to report, and showing
    // "312 / 312" for an uncapped door would read as sold out.
    capacity: stock === null ? null : row.issued + stock,
  };
}

/**
 * Seats still for sale, across variants when the event has tiers.
 *
 * Returns null when the event isn't tracking inventory at all — which for an
 * event means uncapped, not zero.
 */
async function unsoldSeats(
  shopId: string,
  productId: string,
): Promise<number | null> {
  const db = getDb();

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.shopId, shopId)),
    columns: { trackInventory: true, stockQuantity: true },
  });
  if (!product?.trackInventory) return null;

  const [tiers] = await db
    .select({
      total: sql<number>`coalesce(sum(${productVariants.stockQuantity}), 0)::int`,
      rows: sql<number>`count(*)::int`,
    })
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  // Tiers hold the stock when they exist; the product column is only
  // meaningful for an event sold as a single admission type.
  if (tiers && tiers.rows > 0) return tiers.total;
  return product.stockQuantity ?? null;
}

/* -------------------------------------------------------------------------- */
/*  The events worth standing at                                               */
/* -------------------------------------------------------------------------- */

export type EventSummary = {
  id: string;
  title: string;
  slug: string;
  startsAt: Date | null;
  online: boolean;
  location: string | null;
  issued: number;
  checkedIn: number;
};

/**
 * The seller's events, soonest first, with tonight's at the top.
 *
 * Past events stay listed rather than disappearing at the start time. A door
 * is still being worked an hour after the advertised start — that is when the
 * stragglers arrive — and an organiser reconciling attendance the next
 * morning needs the list to still be there.
 */
export async function shopEvents(
  shopId: string,
  { pastDays = 30 }: { pastDays?: number } = {},
): Promise<EventSummary[]> {
  const db = getDb();
  const since = new Date(Date.now() - pastDays * 24 * 3600 * 1000);

  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      slug: products.slug,
      startsAt: products.eventStartsAt,
      serviceMode: products.serviceMode,
      location: products.serviceLocation,
      issued: sql<number>`count(${tickets.id}) filter (where ${tickets.status} <> 'void')::int`,
      checkedIn: sql<number>`count(${tickets.id}) filter (where ${tickets.status} = 'used')::int`,
    })
    .from(products)
    .leftJoin(tickets, eq(tickets.productId, products.id))
    .where(
      and(
        eq(products.shopId, shopId),
        eq(products.kind, "event"),
        // An event with no start time is a row from an older build; keep it
        // reachable rather than filtering it into invisibility.
        or(
          isNull(products.eventStartsAt),
          sql`${products.eventStartsAt} >= ${since}`,
        ),
      ),
    )
    .groupBy(products.id)
    .orderBy(asc(products.eventStartsAt), desc(products.createdAt));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    startsAt: row.startsAt,
    online: row.serviceMode === "online",
    location: row.serviceMode === "online" ? null : row.location,
    issued: row.issued,
    checkedIn: row.checkedIn,
  }));
}

/** One event, confirmed to belong to this shop. Null is a 404 at the caller. */
export async function getShopEvent(shopId: string, productId: string) {
  return getDb().query.products.findFirst({
    where: and(
      eq(products.id, productId),
      eq(products.shopId, shopId),
      eq(products.kind, "event"),
    ),
    columns: {
      id: true,
      title: true,
      slug: true,
      eventStartsAt: true,
      serviceMode: true,
      serviceLocation: true,
      eventJoinUrl: true,
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  The door list                                                              */
/* -------------------------------------------------------------------------- */

export const DOOR_FILTERS = ["all", "in", "out", "revoked"] as const;
export type DoorFilter = (typeof DOOR_FILTERS)[number];

export function isDoorFilter(value: string): value is DoorFilter {
  return (DOOR_FILTERS as readonly string[]).includes(value);
}

export type DoorRow = {
  id: string;
  code: string;
  status: string;
  /** The name to read out: the attendee's own, else whoever bought it. */
  name: string | null;
  email: string | null;
  tier: string | null;
  source: string;
  note: string | null;
  usedAt: Date | null;
  checkedInBy: string | null;
  /** False when the order behind this hasn't been paid — it cannot admit. */
  payable: boolean;
};

export type DoorListFilters = {
  search?: string | null;
  status?: DoorFilter;
  tier?: string | null;
};

/**
 * Names, not orders.
 *
 * Every filter is a WHERE clause. The list is capped, and narrowing the page
 * after the fact would search the first two hundred names and present the
 * result as "nobody called Okonkwo is on this list" — a wrong answer with a
 * silent truncation inside it, which at a door means a guest gets turned away.
 *
 * The search deliberately spans four things a guest might offer: their own
 * name, the name on the card that paid, the email they booked with, and the
 * code itself. Somebody who bought three tickets for friends is found by any
 * of the four, and at a door there is no time to ask which one to try.
 */
export async function eventDoorList(
  shopId: string,
  productId: string,
  filters: DoorListFilters = {},
  limit = 200,
  offset = 0,
): Promise<{ rows: DoorRow[]; total: number }> {
  const db = getDb();

  const search = (filters.search ?? "").trim();
  const like = `%${search}%`;
  // A scanned or typed code arrives in whatever shape the reader produced it.
  const asCode = search ? normalizeTicketCode(search) : "";

  const where = and(
    eq(tickets.shopId, shopId),
    eq(tickets.productId, productId),
    filters.status === "in" ? eq(tickets.status, "used") : undefined,
    filters.status === "out" ? eq(tickets.status, "valid") : undefined,
    filters.status === "revoked" ? eq(tickets.status, "void") : undefined,
    // "all" still hides revoked rows — a cancelled ticket is not somebody the
    // door is waiting for, and leaving them in makes the remaining count lie.
    !filters.status || filters.status === "all"
      ? sql`${tickets.status} <> 'void'`
      : undefined,
    filters.tier ? eq(tickets.tier, filters.tier) : undefined,
    search
      ? or(
          ilike(tickets.attendeeName, like),
          ilike(tickets.attendeeEmail, like),
          ilike(orders.customerName, like),
          ilike(orders.customerEmail, like),
          ilike(tickets.code, `%${asCode}%`),
        )
      : undefined,
  );

  const displayName = sql<
    string | null
  >`coalesce(${tickets.attendeeName}, ${orders.customerName})`;

  const [rows, counted] = await Promise.all([
    db
      .select({
        id: tickets.id,
        code: tickets.code,
        status: tickets.status,
        name: displayName,
        email: sql<
          string | null
        >`coalesce(${tickets.attendeeEmail}, ${orders.customerEmail})`,
        tier: tickets.tier,
        source: tickets.source,
        note: tickets.note,
        usedAt: tickets.usedAt,
        checkedInBy: tickets.checkedInBy,
        orderId: tickets.orderId,
        releasedAt: orders.downloadReleasedAt,
      })
      .from(tickets)
      .leftJoin(orders, eq(orders.id, tickets.orderId))
      .where(where)
      // Alphabetical, because that is how a paper list is read and how a
      // volunteer scans down a screen looking for a surname.
      .orderBy(asc(displayName), asc(tickets.code))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(tickets)
      .leftJoin(orders, eq(orders.id, tickets.orderId))
      .where(where),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      name: row.name,
      email: row.email,
      tier: row.tier,
      source: row.source,
      note: row.note,
      usedAt: row.usedAt,
      checkedInBy: row.checkedInBy,
      // No order behind it means the seller issued it directly, which is its
      // own authority — see the note in `lib/tickets.ts`.
      payable: row.orderId === null || row.releasedAt !== null,
    })),
    total: counted[0]?.total ?? 0,
  };
}

/**
 * Every admission the shop has ever issued, for the export.
 *
 * Deliberately unpaginated and deliberately not filtered to upcoming events:
 * this is the file a seller reconciles last night against and the paper list
 * they carry to the door, and an export that silently stopped at a page
 * boundary would be a list the seller believes is the whole room.
 *
 * Revoked tickets stay in it, with their status in a column. A refunded
 * admission is a thing that happened, and the row explaining why somebody is
 * not on the door list is worth more than its absence.
 */
export async function getShopAttendees(shopId: string) {
  return getDb()
    .select({
      code: tickets.code,
      status: tickets.status,
      usedAt: tickets.usedAt,
      checkedInBy: tickets.checkedInBy,
      source: tickets.source,
      note: tickets.note,
      tier: tickets.tier,
      attendeeName: tickets.attendeeName,
      attendeeEmail: tickets.attendeeEmail,
      orderId: tickets.orderId,
      buyerName: orders.customerName,
      buyerEmail: orders.customerEmail,
      eventTitle: products.title,
      eventStartsAt: products.eventStartsAt,
    })
    .from(tickets)
    .leftJoin(orders, eq(orders.id, tickets.orderId))
    .leftJoin(products, eq(products.id, tickets.productId))
    .where(eq(tickets.shopId, shopId))
    .orderBy(
      asc(products.eventStartsAt),
      asc(sql`coalesce(${tickets.attendeeName}, ${orders.customerName})`),
      asc(tickets.code),
    );
}

/** The tiers actually present on this event's tickets, for the filter. */
export async function eventTiers(
  shopId: string,
  productId: string,
): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ tier: tickets.tier })
    .from(tickets)
    .where(and(eq(tickets.shopId, shopId), eq(tickets.productId, productId)))
    .orderBy(asc(tickets.tier));
  return rows.map((r) => r.tier).filter((t): t is string => Boolean(t));
}
