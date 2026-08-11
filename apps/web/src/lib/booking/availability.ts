import "server-only";
import { and, eq, gte, isNotNull, lt, ne, notInArray } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { bookingClaims, orderItems, orders, type Shop } from "@sailo/db/schema";
import { hoursOf } from "./hours";
import { zoneOf } from "./time-zone";
import { externalBusyFor } from "./external-busy";
import { can } from "@/lib/plans";
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
}): Promise<Busy[]> {
  const rows = await getDb()
    .select({
      scheduledFor: orderItems.scheduledFor,
      orderId: orderItems.orderId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.productId, opts.productId),
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
        eq(bookingClaims.productId, opts.productId),
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
    now,
    /*
     * One list. The generator asks "does this candidate overlap anything",
     * and an appointment Sailo owes and an hour the seller's own calendar
     * has already spent are the same answer to that question.
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
