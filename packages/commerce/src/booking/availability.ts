import "server-only";
import { and, eq, gte, isNotNull, lt, ne, notInArray } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { bookingClaims, orderItems, orders, type Shop } from "@sailo/db/schema";
import { hoursOf } from "./hours";
import { zoneOf } from "./time-zone";
import { externalBusyFor } from "./external-busy";
import { can } from "@sailo/core/plans";
import { slotsForDays, todayIn, type Busy, type DaySlots, type SlotOptions } from "./slots";

/**
 * What a shop has already promised, and what it can still offer.
 *
 * The database half of booking: everything else in this folder is pure, and
 * this is the only file that knows an order exists.
 */

/** Statuses whose appointment no longer holds the time. */
const RELEASED_STATUSES = ["cancelled", "refunded"] as const;

/**
 * Appointments already on the books for one product, in a window.
 *
 * Read from `orderItems` rather than the order header: the header's
 * `scheduledFor` describes the first booked line only, so a basket holding two
 * different appointments would hide one of them — the seventh bug of that
 * shape in this codebase.
 *
 * A cancelled or refunded order releases its time, exactly as it releases its
 * stock. `excludeOrderId` lets a seller reschedule an order without it
 * clashing with itself.
 */
export async function busyFor(opts: {
  productId: string;
  from: Date;
  to: Date;
  durationMinutes: number;
  excludeOrderId?: string;
  /**
   * Whose diary to read — spec 51.
   *
   * Named, this asks about one *person* across every service they do: a
   * stylist booked for a colour at ten is not free for a cut at ten, and the
   * product-keyed read could never see that. Absent, it asks about one
   * *product*, which is exactly what a shop with no staff has always meant and
   * what the exclusion constraint still enforces for them.
   */
  staffId?: string | null;
}): Promise<Busy[]> {
  /*
   * The subject of both reads below, and the one line that decides which
   * question is being asked. With a staff id the product falls out of it
   * entirely — that is the point — and without one nothing changes.
   */
  const lineSubject = opts.staffId
    ? eq(orderItems.staffId, opts.staffId)
    : eq(orderItems.productId, opts.productId);
  /*
   * Without a staff id this reads **every** claim on the product, assigned or
   * not, and that is the whole of a bug worth writing down.
   *
   * It used to add `staff_id is null`, on the reasoning that a shop which has
   * just added staff holds old unassigned claims and new assigned ones, and
   * treating the lot as "anybody's" would show every stylist as busy whenever
   * any one of them was. True — but that is a *per-person* question, and a
   * per-person question always names the person. The only caller that omits
   * the id is the product-keyed calendar, which `offeredByStaff` reaches only
   * when the shop has no active roster at all.
   *
   * With the filter, deactivating a roster while somebody is mid-checkout hid
   * their claim: `booking_claims_no_overlap` keys on
   * `coalesce(staff_id, product_id)`, so the second buyer's unassigned claim
   * had a different key, did not collide, and both reached payment for one
   * slot. `order_items` has no exclusion constraint to catch it afterwards.
   *
   * A shop that never had staff is unaffected — every claim it has is already
   * unassigned, so the wider read returns the same rows.
   */
  const claimSubject = opts.staffId
    ? eq(bookingClaims.staffId, opts.staffId)
    : eq(bookingClaims.productId, opts.productId);

  const rows = await getDb()
    .select({
      scheduledFor: orderItems.scheduledFor,
      orderId: orderItems.orderId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        lineSubject,
        isNotNull(orderItems.scheduledFor),
        gte(orderItems.scheduledFor, opts.from),
        lt(orderItems.scheduledFor, opts.to),
        notInArray(orders.status, [...RELEASED_STATUSES]),
        ...(opts.excludeOrderId ? [ne(orders.id, opts.excludeOrderId)] : []),
      ),
    );

  /*
   * The claims as well as the lines.
   *
   * They agree almost always — a claim is written with the order and deleted
   * when it is cancelled — but "almost" is the whole problem this read used to
   * have. `booking_claims` is what the unique index actually enforces, so a
   * slot held there is unavailable whatever the order rows say, and showing it
   * as free would offer a buyer a time the database will then refuse them at
   * checkout.
   */
  const claims = await getDb()
    .select({
      startsAt: bookingClaims.startsAt,
      /*
       * The stored end, not one recomputed from the product's *current*
       * duration. A seller who shortens a service after somebody has booked it
       * would otherwise have the calendar offer a slot the exclusion
       * constraint then refuses — the buyer picks a time that looks free and
       * the checkout tells them it is taken.
       */
      endsAt: bookingClaims.endsAt,
    })
    .from(bookingClaims)
    .innerJoin(orders, eq(orders.id, bookingClaims.orderId))
    .where(
      and(
        claimSubject,
        gte(bookingClaims.startsAt, opts.from),
        lt(bookingClaims.startsAt, opts.to),
        ...(opts.excludeOrderId ? [ne(orders.id, opts.excludeOrderId)] : []),
      ),
    );

  /*
   * Keyed by start so an order row and its claim row do not count twice, and
   * the claim's stored range wins where both exist — it is what the database
   * will actually enforce.
   */
  const busy = new Map<number, Busy>();
  for (const row of rows) {
    if (!row.scheduledFor) continue;
    busy.set(row.scheduledFor.getTime(), {
      startsAt: row.scheduledFor,
      endsAt: new Date(row.scheduledFor.getTime() + opts.durationMinutes * 60_000),
    });
  }
  for (const row of claims) {
    busy.set(row.startsAt.getTime(), { startsAt: row.startsAt, endsAt: row.endsAt });
  }

  return [...busy.values()];
}

/**
 * Everything the calendar needs to know about the shop.
 *
 * Named rather than written inline at three call sites, because it grew the
 * billing columns when busy-sync arrived and a `Pick` repeated in three
 * places is three places to forget.
 */
export type BookingShop = Pick<
  Shop,
  | "id"
  | "bookingHours"
  | "timeZone"
  | "bookingSlotMinutes"
  | "calendarFeedUrl"
  | "plan"
  | "subscriptionStatus"
  | "compPlan"
>;

export type BookableProduct = {
  id: string;
  durationMinutes: number | null;
  bookingLeadHours: number;
  /**
   * Quiet minutes either side of an appointment.
   *
   * Required, not optional, and that is the point: both callers select
   * explicit `columns`, so an optional field would simply be absent from the
   * buyer's calendar route and the buffer would apply at checkout and nowhere
   * else — the seller would see their gap honoured only when somebody was
   * refused a slot the page had just offered them. Required makes a caller
   * that forgets the column a compile error.
   */
  bookingBufferMinutes: number;
  bookingEnabled: boolean;
  kind: string;
};


/** A service the shop is actually taking appointments for. */
export function isBookable(product: BookableProduct): boolean {
  return (
    product.kind === "service" &&
    product.bookingEnabled &&
    (product.durationMinutes ?? 0) > 0
  );
}

/**
 * Everything the pure slot generator needs, assembled from a shop and product.
 *
 * `includeExternal` decides whether the seller's own calendar is subtracted
 * too, and it is off by default on purpose — see `calendarFor`, which is the
 * one caller that turns it on.
 */
export async function slotOptionsFor(
  shop: BookingShop,
  product: BookableProduct,
  window: { from: Date; to: Date },
  now: Date,
  excludeOrderId?: string,
  includeExternal = false,
): Promise<SlotOptions> {
  const durationMinutes = product.durationMinutes ?? 0;

  const [busy, external] = await Promise.all([
    busyFor({
      productId: product.id,
      from: window.from,
      to: window.to,
      durationMinutes,
      excludeOrderId,
    }),
    includeExternal && can(shop, "calendarSync")
      ? externalBusyFor(shop, window, now)
      : Promise.resolve<Busy[]>([]),
  ]);

  return {
    hours: hoursOf(shop.bookingHours),
    timeZone: zoneOf(shop.timeZone),
    durationMinutes,
    leadHours: product.bookingLeadHours,
    stepMinutes: shop.bookingSlotMinutes ?? undefined,
    /*
     * Handed to the generator rather than applied to `busy` here, so that
     * `isOfferedSlot` — which re-derives the calendar to check the time a
     * buyer actually picked — honours the gap without being told. Enforcing it
     * on the listing alone would be a gap the seller could watch somebody book
     * straight through.
     */
    bufferMinutes: product.bookingBufferMinutes,
    now,
    /*
     * One list. The generator asks "does this candidate overlap anything",
     * and an appointment Sailo owes and an hour the seller's own calendar
     * has already spent are the same answer to that question — which is also
     * why the buffer applies to both. The gap exists so the seller is not
     * walking out of one thing into the next, and a dentist appointment in
     * their own diary is exactly that.
     */
    busy: [...busy, ...external],
  };
}

/** How far ahead a buyer may book. Beyond this a calendar is guesswork. */
export const BOOKING_HORIZON_DAYS = 60;

/**
 * The calendar a buyer sees: one entry per day, free slots inside.
 *
 * The busy window is widened by a day at each end so an appointment that
 * starts just outside it but runs into the range still blocks what it should.
 */
export async function calendarFor(
  shop: BookingShop,
  product: BookableProduct,
  opts: { days: number; now: Date; excludeOrderId?: string },
): Promise<DaySlots[]> {
  if (!isBookable(product)) return [];

  const days = Math.max(1, Math.min(BOOKING_HORIZON_DAYS, opts.days));
  const from = new Date(opts.now.getTime() - 24 * 3_600_000);
  const to = new Date(opts.now.getTime() + (days + 1) * 24 * 3_600_000);

  /*
   * The seller's own calendar is subtracted *here* and not at checkout.
   *
   * Two reasons, and the second is the one that matters. Displaying fewer
   * slots is the whole feature: a time the seller has already spent must not
   * be offered. But re-checking it when the order arrives would put an
   * outbound HTTP request on the money path, where a slow third party becomes
   * a slow checkout and — worse — where a feed that answers differently from
   * the one the buyer saw a minute ago rejects an order for a time that
   * looked free. The write-time guard stays what it has always been: the
   * exclusion constraint, which is about Sailo's own promises. A buyer who
   * forges a payload past the display gets a booking the seller declines,
   * which is exactly what happens today.
   */
  const options = await slotOptionsFor(
    shop,
    product,
    { from, to },
    opts.now,
    opts.excludeOrderId,
    true,
  );
  return slotsForDays(todayIn(options.timeZone, opts.now), days, options);
}
