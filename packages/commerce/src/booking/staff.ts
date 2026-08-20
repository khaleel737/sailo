import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  productStaff,
  staffResources,
  type StaffResource,
  type WeeklyHours,
} from "@sailo/db/schema";
import {
  busyFor,
  calendarFor,
  isBookable,
  BOOKING_HORIZON_DAYS,
  type BookableProduct,
  type BookingShop,
} from "./availability";
import { externalBusyFor, isCalendarFeedUrl, normalizeFeedUrl } from "./external-busy";
import { hoursOf } from "./hours";
import { isTimeZone, zoneOf } from "./time-zone";
import {
  isOfferedSlot,
  slotsForDays,
  todayIn,
  type Busy,
  type DaySlots,
  type SlotOptions,
} from "./slots";
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
  const days = Math.max(1, Math.min(BOOKING_HORIZON_DAYS, opts.days));
  const from = new Date(opts.now.getTime() - 24 * 3_600_000);
  const to = new Date(opts.now.getTime() + (days + 1) * 24 * 3_600_000);

  /*
   * `includeExternal` is on here and off at checkout, which is the same split
   * `calendarFor` makes and for the same two reasons: a time the seller has
   * already spent must not be *offered*, and re-fetching a third party's
   * calendar when the order arrives would put an outbound HTTP request on the
   * money path — where a feed that answers differently from the one the buyer
   * saw a minute ago rejects an order for a time that looked free.
   */
  const options = await slotOptionsForStaff(
    shop,
    product,
    staff,
    { from, to },
    opts.now,
    opts.excludeOrderId,
    true,
  );

  return slotsForDays(todayIn(options.timeZone, opts.now), days, options);
}

/**
 * Everything the pure slot generator needs, assembled for one person.
 *
 * The staff-shaped twin of `slotOptionsFor`, and it is a named function rather
 * than the middle of `calendarForStaff` because two callers need it: the
 * calendar, which renders a fortnight, and the checkout, which re-derives the
 * one time a buyer actually picked. A second copy of "their hours if they have
 * any, the shop's if not" is a second place for the two to drift, and the
 * symptom would be a slot the page offered and the order refused.
 */
export async function slotOptionsForStaff(
  shop: BookingShop,
  product: BookableProduct,
  staff: StaffResource,
  window: { from: Date; to: Date },
  now: Date,
  excludeOrderId?: string,
  includeExternal = false,
): Promise<SlotOptions> {
  const durationMinutes = product.durationMinutes ?? 0;

  const [busy, external] = await Promise.all([
    busyFor({
      productId: product.id,
      staffId: staff.id,
      from: window.from,
      to: window.to,
      durationMinutes,
      excludeOrderId,
    }),
    /*
     * Their feed, not the shop's — and only when the plan includes calendar
     * sync, exactly as `calendarFor` gates the shop's own. A stylist's dentist
     * appointment blocks their slots and nobody else's, which is the whole
     * reason the column is on the resource rather than on the shop.
     */
    includeExternal && staff.calendarFeedUrl && can(shop, "calendarSync")
      ? externalBusyFor(
          { ...shop, calendarFeedUrl: staff.calendarFeedUrl },
          window,
          now,
        )
      : Promise.resolve<Busy[]>([]),
  ]);

  const timeZone = zoneOf(staff.timeZone ?? shop.timeZone);

  return {
    hours: hoursOf(staff.hours ?? shop.bookingHours),
    timeZone,
    durationMinutes,
    leadHours: product.bookingLeadHours,
    stepMinutes: shop.bookingSlotMinutes ?? undefined,
    bufferMinutes: product.bookingBufferMinutes,
    now,
    busy: [...busy, ...external],
  };
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
 * The calendar a buyer sees, with the roster consulted — spec 51.
 *
 * **This is the function that makes the roster real, and the one every buyer
 * path should call instead of `calendarFor`.** Until it existed, a shop could
 * put three stylists on the screen and the storefront went on asking the
 * product-keyed question: `busyFor` without a `staffId` reads *every* order
 * line for the product, so the moment one stylist was booked at ten, ten
 * vanished for all three. A salon that paid for staff got a calendar that
 * offered less than it could sell.
 *
 * The fallback is the data and not a flag. `staffCalendars` answers with an
 * empty list when a shop has no rows — which is every shop the day this ships —
 * and then this is `calendarFor` unchanged, byte for byte.
 *
 * Which *person* a slot came from is deliberately dropped here. A buyer who
 * books "10:00 with anyone" is making a different promise from one who books
 * "10:00 with Sam", and only `firstFreeStaff` — asked at the instant the claim
 * is taken — can settle the first honestly. `staffCalendars` still returns the
 * rows for the day a storefront lets a buyer choose.
 */
export async function calendarWithStaff(
  shop: BookingShop,
  product: BookableProduct,
  opts: { days: number; now: Date; excludeOrderId?: string },
): Promise<DaySlots[]> {
  if (!isBookable(product)) return [];

  const perStaff = await staffCalendars(shop, product, opts);
  if (perStaff.length === 0) return calendarFor(shop, product, opts);

  return unionOfDays(perStaff);
}

/**
 * Whether *somebody* can take this exact time — the roster's answer to the
 * question `isOfferedSlot` asks of a shop with no staff.
 *
 * The checkout's half of `calendarWithStaff`, and it has to exist for the same
 * reason that one does: `resolveLines` re-derives the slot server-side before
 * writing anything, and the product-keyed re-derivation would refuse a time
 * another stylist had taken. A buyer would be offered ten o'clock by the page
 * and told at checkout that it had just gone, with nobody having booked it.
 *
 * `{ roster: false }` rather than `false`, because "this shop has no staff" and
 * "nobody is free" are different answers and only the first means *ask the old
 * question instead*. Collapsing them would refuse every booking in every shop
 * that has no roster, which is nearly all of them.
 *
 * The external feed is **not** subtracted here, exactly as it is not in
 * `slotOptionsFor`'s checkout path: a third party's calendar on the money path
 * is a slow checkout at best and, at worst, an order refused for a time that
 * looked free a minute ago.
 */
export async function offeredByStaff(
  shop: BookingShop,
  product: BookableProduct,
  startsAt: Date,
  opts: { now: Date; excludeOrderId?: string },
): Promise<{ roster: false } | { roster: true; offered: boolean }> {
  const people = await staffFor(shop.id, product.id);
  if (people.length === 0) return { roster: false };

  const window = {
    from: new Date(startsAt.getTime() - 24 * 3_600_000),
    to: new Date(startsAt.getTime() + 24 * 3_600_000),
  };

  const options = await Promise.all(
    people.map((staff) =>
      slotOptionsForStaff(
        shop,
        product,
        staff,
        window,
        opts.now,
        opts.excludeOrderId,
      ),
    ),
  );

  return {
    roster: true,
    offered: options.some((option) => isOfferedSlot(startsAt, option)),
  };
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

/* ══════════════════════════════════════════════════════════════════════════
 *  THE WRITE HALF — spec 51's roster
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Everything above is a read, and it stayed a read for a wave: the tables, the
 * arithmetic and `staff-bookings.scenario.ts` all existed while nothing in
 * `apps/web` could put a row in either table. These four functions are the way
 * in, and they live here rather than in the app for the reason the reads do —
 * one file knows what a bookable person is, and a second copy of "which ids
 * belong to this shop" is a second place to forget the `shopId`.
 */

/**
 * How many people one shop may have on its roster.
 *
 * Not a plan throttle — `can(shop, "staffResources")` is the gate, and it is
 * decided by the caller. This is the ceiling that stops a scripted POST
 * writing rows until the calendar takes a minute to render, since
 * `staffCalendars` fans out one query set per person.
 */
export const MAX_STAFF = 60;

export type StaffInput = {
  /** Null adds. An id edits, and must already belong to this shop. */
  id?: string | null;
  name: string;
  email?: string | null;
  /** Null is "the shop's hours", which is what most rosters mean. */
  hours?: WeeklyHours | null;
  /** Null is the shop's zone. */
  timeZone?: string | null;
  /**
   * Their own iCal address.
   *
   * **`undefined` leaves what is stored alone; `null` disconnects.** The URL is
   * a bearer token for somebody's whole calendar, so no screen renders it back
   * — which means a blank field cannot mean "clear it", or saving a name would
   * silently disconnect a stylist's calendar and quietly re-offer every hour
   * they are already busy. The shop's own feed is read the same way, for the
   * same reason, in `readCalendarFeed`.
   */
  calendarFeedUrl?: string | null;
  isActive?: boolean;
};

export type SaveStaffRefusal =
  | { kind: "no_name" }
  | { kind: "not_found" }
  | { kind: "feed_not_public" }
  | { kind: "roster_full"; limit: number };

export type SaveStaffResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; refusal: SaveStaffRefusal };

/**
 * Adding or editing somebody a buyer can book.
 *
 * The refusals are a closed union rather than sentences, exactly as
 * `saveProduct`'s are: the wording belongs to whichever surface is asking, and
 * a new refusal should be a compile error at every caller rather than a string
 * nobody handles.
 */
export async function saveStaff(
  shopId: string,
  input: StaffInput,
): Promise<SaveStaffResult> {
  const db = getDb();

  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, refusal: { kind: "no_name" } };

  /*
   * Normalised then re-checked, never merely trimmed. `normalizeFeedUrl`
   * rewrites the `webcal://` every provider hands out — without it the feature
   * fails on first paste — and `isCalendarFeedUrl` is the same public-host
   * denylist the shop's feed goes through, because our server is what fetches
   * it. A blank string is not a URL and not a disconnection: it is the field
   * the seller did not touch.
   */
  let feed: string | null | undefined;
  if (input.calendarFeedUrl === null) {
    feed = null;
  } else if (typeof input.calendarFeedUrl === "string" && input.calendarFeedUrl.trim()) {
    const url = normalizeFeedUrl(input.calendarFeedUrl);
    if (!isCalendarFeedUrl(url)) {
      return { ok: false, refusal: { kind: "feed_not_public" } };
    }
    feed = url;
  }

  const values = {
    name,
    email: input.email?.trim().slice(0, 200) || null,
    hours: input.hours ?? null,
    timeZone: input.timeZone && isTimeZone(input.timeZone) ? input.timeZone : null,
    isActive: input.isActive ?? true,
    updatedAt: new Date(),
  };

  if (input.id) {
    const owned = await db.query.staffResources.findFirst({
      where: and(eq(staffResources.id, input.id), eq(staffResources.shopId, shopId)),
      columns: { id: true },
    });
    // "Not yours" and "doesn't exist" are one answer, as everywhere else.
    if (!owned) return { ok: false, refusal: { kind: "not_found" } };

    await db
      .update(staffResources)
      .set(feed === undefined ? values : { ...values, calendarFeedUrl: feed })
      .where(eq(staffResources.id, input.id));

    return { ok: true, id: input.id, created: false };
  }

  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(staffResources)
    .where(eq(staffResources.shopId, shopId));
  if ((counted?.n ?? 0) >= MAX_STAFF) {
    return { ok: false, refusal: { kind: "roster_full", limit: MAX_STAFF } };
  }

  const [maxed] = await db
    .select({ max: sql<string>`coalesce(max(${staffResources.position}), 0)` })
    .from(staffResources)
    .where(eq(staffResources.shopId, shopId));

  const [row] = await db
    .insert(staffResources)
    .values({
      ...values,
      calendarFeedUrl: feed ?? null,
      shopId,
      position: Number(maxed?.max ?? 0) + 1,
    })
    .returning({ id: staffResources.id });
  if (!row) throw new Error("staff resource was not inserted");

  return { ok: true, id: row.id, created: true };
}

/**
 * Taking somebody off the rota, or putting them back.
 *
 * A flag and not a delete, and that is the whole reason the column exists.
 * `order_items.staff_id` and `booking_claims.staff_id` are `ON DELETE SET
 * NULL`, so removing the row would quietly detach every appointment they have
 * ever taken — a seller looking at last month would see who did the work turn
 * into nobody. Deactivating keeps the history and stops the offers: `staffFor`
 * reads `is_active`, so the next calendar simply does not include them.
 *
 * Answers whether a row moved, so a caller can tell "done" from "never yours"
 * without a read that would have raced the update anyway.
 */
export async function setStaffActive(
  shopId: string,
  staffId: string,
  isActive: boolean,
): Promise<boolean> {
  const rows = await getDb()
    .update(staffResources)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(staffResources.id, staffId), eq(staffResources.shopId, shopId)))
    .returning({ id: staffResources.id });
  return rows.length > 0;
}

/**
 * Which people take bookings for one service.
 *
 * Replaced wholesale, the way a product's images are: the set *is* the answer,
 * and a diff would need an identity the join table does not have.
 *
 * The ids are filtered against this shop's own roster rather than trusted. The
 * caller has already proved it owns the product; nothing has proved it owns
 * the ids, and a crafted POST naming another shop's stylist would otherwise
 * put that person's diary in front of this shop's buyers.
 *
 * **An empty set is meaningful and is not an error.** No rows means every
 * active person in the shop, which is what a single-chair salon means and
 * saves them a screen — see `staffFor`.
 */
export async function setProductStaff(
  shopId: string,
  productId: string,
  staffIds: string[],
): Promise<void> {
  const db = getDb();

  const mine =
    staffIds.length === 0
      ? []
      : await db
          .select({ id: staffResources.id })
          .from(staffResources)
          .where(
            and(
              eq(staffResources.shopId, shopId),
              inArray(staffResources.id, [...new Set(staffIds)].slice(0, MAX_STAFF)),
            ),
          );

  await db.delete(productStaff).where(eq(productStaff.productId, productId));
  if (mine.length === 0) return;

  await db
    .insert(productStaff)
    .values(mine.map((row) => ({ productId, staffId: row.id })));
}

/** The people already named on one service, for the editor that lists them. */
export async function staffIdsFor(productId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ staffId: productStaff.staffId })
    .from(productStaff)
    .where(eq(productStaff.productId, productId));
  return rows.map((row) => row.staffId);
}
