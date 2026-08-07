import "server-only";
import { and, eq, gte, isNotNull, lt, ne, notInArray } from "drizzle-orm";
import { getDb } from "@/db";
import { bookingClaims, orderItems, orders, type Shop } from "@/db/schema";
import { hoursOf } from "./hours";
import { zoneOf } from "./time-zone";
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
    .select({ startsAt: bookingClaims.startsAt })
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

  const starts = new Set<number>();
  for (const row of rows) {
    if (row.scheduledFor) starts.add(row.scheduledFor.getTime());
  }
  for (const row of claims) starts.add(row.startsAt.getTime());

  return [...starts].map((ms) => ({
    startsAt: new Date(ms),
    endsAt: new Date(ms + opts.durationMinutes * 60_000),
  }));
}

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

/** Everything the pure slot generator needs, assembled from a shop and product. */
export async function slotOptionsFor(
  shop: Pick<Shop, "bookingHours" | "timeZone" | "bookingSlotMinutes">,
  product: BookableProduct,
  window: { from: Date; to: Date },
  now: Date,
  excludeOrderId?: string,
): Promise<SlotOptions> {
  const durationMinutes = product.durationMinutes ?? 0;

  return {
    hours: hoursOf(shop.bookingHours),
    timeZone: zoneOf(shop.timeZone),
    durationMinutes,
    leadHours: product.bookingLeadHours,
    stepMinutes: shop.bookingSlotMinutes ?? undefined,
    now,
    busy: await busyFor({
      productId: product.id,
      from: window.from,
      to: window.to,
      durationMinutes,
      excludeOrderId,
    }),
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
  shop: Pick<Shop, "bookingHours" | "timeZone" | "bookingSlotMinutes">,
  product: BookableProduct,
  opts: { days: number; now: Date; excludeOrderId?: string },
): Promise<DaySlots[]> {
  if (!isBookable(product)) return [];

  const days = Math.max(1, Math.min(BOOKING_HORIZON_DAYS, opts.days));
  const from = new Date(opts.now.getTime() - 24 * 3_600_000);
  const to = new Date(opts.now.getTime() + (days + 1) * 24 * 3_600_000);

  const options = await slotOptionsFor(shop, product, { from, to }, opts.now, opts.excludeOrderId);
  return slotsForDays(todayIn(options.timeZone, opts.now), days, options);
}
