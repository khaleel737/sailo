import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  productStaff,
  staffResources,
  type StaffResource,
} from "@sailo/db/schema";
import { busyFor, type BookableProduct, type BookingShop } from "./availability";
import { externalBusyFor } from "./external-busy";
import { hoursOf } from "./hours";
import { zoneOf } from "./time-zone";
import { slotsForDays, todayIn, type Busy, type DaySlots } from "./slots";
import { can } from "@sailo/core/plans";

/**
 * More than one bookable person — spec 51.
 *
 * `shops.bookingHours` is the shop's hours, so a salon with three stylists had
 * one calendar and could take one appointment at a time. This is the read half
 * of closing that; `booking_claims_no_overlap` re-keyed to
 * `COALESCE(staff_id, product_id)` is the write half, and it is the one that
 * actually guarantees anything.
 *
 * ONE RULE RUNS THROUGH EVERY FUNCTION HERE
 *
 * **A shop with no `staff_resources` rows behaves exactly as it does today.**
 * `staffFor` answers with an empty list, `calendarForStaff` is never reached,
 * and `calendarFor` — untouched — keeps generating the shop's own slots. No
 * branch in a caller has to remember that; it falls out of the data.
 */

/**
 * The people who may take this service.
 *
 * **No `product_staff` rows means every active resource in the shop**, which is
 * what a single-service salon means and saves them a screen. A seller who
 * wants one stylist to own one service says so by adding a row, and then only
 * the named ones are offered.
 */
export async function staffFor(
  shopId: string,
  productId: string,
): Promise<StaffResource[]> {
  const db = getDb();

  const named = await db
    .select({ staff: staffResources })
    .from(productStaff)
    .innerJoin(staffResources, eq(staffResources.id, productStaff.staffId))
    .where(
      and(
        eq(productStaff.productId, productId),
        eq(staffResources.shopId, shopId),
        eq(staffResources.isActive, true),
      ),
    )
    .orderBy(asc(staffResources.position), asc(staffResources.name));

  if (named.length > 0) return named.map((row) => row.staff);

  return db.query.staffResources.findMany({
    where: and(
      eq(staffResources.shopId, shopId),
      eq(staffResources.isActive, true),
    ),
    orderBy: [asc(staffResources.position), asc(staffResources.name)],
  });
}

/** Every bookable person in a shop, for the settings screen. */
export async function listStaff(shopId: string): Promise<StaffResource[]> {
  return getDb().query.staffResources.findMany({
    where: eq(staffResources.shopId, shopId),
    orderBy: [asc(staffResources.position), asc(staffResources.name)],
  });
}

/**
 * One person's calendar for a service.
 *
 * Their own hours if they have any, the shop's if not; their own zone if they
 * have one, the shop's if not; their own iCal feed subtracted rather than the
 * shop's. Everything falls back, so a stylist who works the shop's hours is one
 * row and no configuration.
 *
 * `busyFor` is asked about the **person**, not the product — a stylist booked
 * for a colour at ten is not free for a cut at ten, and the product-keyed read
 * could never see that. It is the same asymmetry the exclusion constraint now
 * carries, asked as a read.
 */
export async function calendarForStaff(
  shop: BookingShop,
  product: BookableProduct,
  staff: StaffResource,
  opts: { days: number; now: Date; excludeOrderId?: string },
): Promise<DaySlots[]> {
  const durationMinutes = product.durationMinutes ?? 0;
  const days = Math.max(1, Math.min(60, opts.days));
  const from = new Date(opts.now.getTime() - 24 * 3_600_000);
  const to = new Date(opts.now.getTime() + (days + 1) * 24 * 3_600_000);

  const [busy, external] = await Promise.all([
    busyFor({
      productId: product.id,
      staffId: staff.id,
      from,
      to,
      durationMinutes,
      excludeOrderId: opts.excludeOrderId,
    }),
    /*
     * Their feed, not the shop's — and only when the plan includes calendar
     * sync, exactly as `calendarFor` gates the shop's own. A stylist's dentist
     * appointment blocks their slots and nobody else's, which is the whole
     * reason the column is on the resource rather than on the shop.
     */
    staff.calendarFeedUrl && can(shop, "calendarSync")
      ? externalBusyFor(
          { ...shop, calendarFeedUrl: staff.calendarFeedUrl },
          { from, to },
          opts.now,
        )
      : Promise.resolve<Busy[]>([]),
  ]);

  const timeZone = zoneOf(staff.timeZone ?? shop.timeZone);

  return slotsForDays(todayIn(timeZone, opts.now), days, {
    hours: hoursOf(staff.hours ?? shop.bookingHours),
    timeZone,
    durationMinutes,
    leadHours: product.bookingLeadHours,
    stepMinutes: shop.bookingSlotMinutes ?? undefined,
    bufferMinutes: product.bookingBufferMinutes,
    now: opts.now,
    busy: [...busy, ...external],
  });
}

export type StaffDay = {
  staff: StaffResource;
  days: DaySlots[];
};

/**
 * Every eligible person's calendar, for a buyer picking "who".
 *
 * Returned per person rather than merged into one list of times, and that is a
 * decision rather than a convenience: a buyer who books "10:00 with anyone" and
 * a buyer who books "10:00 with Sam" are making different promises, and only
 * the second can be honoured when Sam is off sick. The union is what the
 * *storefront* shows when the seller offers "any available"; the rows are what
 * a buyer picks from when they care.
 */
export async function staffCalendars(
  shop: BookingShop,
  product: BookableProduct,
  opts: { days: number; now: Date; excludeOrderId?: string },
): Promise<StaffDay[]> {
  const people = await staffFor(shop.id, product.id);
  if (people.length === 0) return [];

  return Promise.all(
    people.map(async (staff) => ({
      staff,
      days: await calendarForStaff(shop, product, staff, opts),
    })),
  );
}

/**
 * "Any available" — the union of everybody's free times.
 *
 * A slot is offered when *somebody* can take it, which is what a buyer who
 * does not care means. The person is chosen at checkout by
 * `firstFreeStaff`, not here: a calendar cached for a minute and a booking
 * made now must not disagree about who is free, and the only honest way to
 * settle that is to ask again at the moment the claim is taken.
 */
export function unionOfDays(perStaff: StaffDay[]): DaySlots[] {
  const byDate = new Map<string, Map<number, DaySlots["slots"][number]>>();

  for (const entry of perStaff) {
    for (const day of entry.days) {
      const slots = byDate.get(day.date) ?? new Map();
      for (const slot of day.slots) slots.set(slot.startsAt.getTime(), slot);
      byDate.set(day.date, slots);
    }
  }

  return [...byDate.entries()]
    .map(([date, slots]) => ({
      date,
      slots: [...slots.values()].sort(
        (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
      ),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Who to book, when the buyer did not say.
 *
 * Asked at the moment the claim is taken rather than when the calendar was
 * rendered, because those are different instants and the second one is the
 * one that has to be true. Returns null when nobody is free, which the caller
 * turns into the ordinary "that slot just went" refusal.
 *
 * **This is a read, and it is not the guard.** The guard is the exclusion
 * constraint: two buyers racing for the last stylist can both be told "Sam is
 * free" here, and exactly one of them gets the insert. That is why the claim
 * returns a boolean rather than trusting this.
 */
export async function firstFreeStaff(input: {
  shopId: string;
  productId: string;
  startsAt: Date;
  endsAt: Date;
}): Promise<StaffResource | null> {
  const people = await staffFor(input.shopId, input.productId);
  if (people.length === 0) return null;

  for (const staff of people) {
    const busy = await busyFor({
      productId: input.productId,
      staffId: staff.id,
      from: new Date(input.startsAt.getTime() - 24 * 3_600_000),
      to: new Date(input.endsAt.getTime() + 24 * 3_600_000),
      durationMinutes: Math.max(
        0,
        Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000),
      ),
    });

    const clashes = busy.some(
      (b) =>
        b.startsAt.getTime() < input.endsAt.getTime() &&
        b.endsAt.getTime() > input.startsAt.getTime(),
    );
    if (!clashes) return staff;
  }
  return null;
}
