import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { shops } from "./shop";
import { products } from "./catalog";
import type { WeeklyHours } from "./hours";

/**
 * The people a buyer books, as opposed to the people who log in — spec 51.
 *
 * Its own file rather than a corner of `catalog.ts`, and deliberately not
 * `staff.ts`: that one is *Sailo's* own staff and their platform capabilities,
 * which is a different subject entirely and shares nothing but a word.
 */

/**
 * Somebody a buyer can book.
 *
 * `shops.bookingHours` is the *shop's* hours, so a salon with three stylists
 * had one calendar and could take one appointment at a time. That is the gap
 * that stopped Sailo serving anyone with staff.
 *
 * **NOT `shopMembers` (spec 37), and the difference is the point.** A stylist
 * is a bookable *resource*; a team member is a *login*. Some people are both
 * and the tables may reference each other, but a resource with no account is
 * the common case — a contractor — and a member who takes no bookings is
 * equally common: a bookkeeper. Two tables, said here so nobody merges them.
 *
 * Every column but the name falls back to the shop's, so adding a stylist who
 * works the shop's hours is one row and no configuration — the `0034`
 * discipline applied to a table rather than to a column.
 */
export const staffResources = pgTable(
  "staff_resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    /** `WeeklyHours`, falling back to the shop's when null. */
    hours: jsonb("hours").$type<WeeklyHours | null>(),
    timeZone: text("time_zone"),
    /**
     * Their own iCal address, read under the same SSRF guard and 60s cache
     * spec 17 built for the shop's — per staff, so one stylist's dentist
     * appointment blocks their slots and nobody else's.
     */
    calendarFeedUrl: text("calendar_feed_url"),
    isActive: boolean("is_active").default(true).notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("staff_resources_shop_idx").on(t.shopId, t.isActive, t.position),
    // The `/api/v1` keyset, so every list endpoint has one plan shape.
    index("staff_resources_shop_keyset_idx").on(t.shopId, t.createdAt, t.id)],
);

/**
 * Which people can be booked for which service.
 *
 * **No rows for a product means every active resource in the shop.** That is
 * what a single-service salon means and it saves them a screen; a seller who
 * wants one stylist to own one service says so by adding a row.
 */
export const productStaff = pgTable(
  "product_staff",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffResources.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.staffId] }),
    index("product_staff_staff_idx").on(t.staffId),
  ],
);

/**
 * The seats already taken in one class slot — spec 51.
 *
 * A counter row, and it exists because of what Postgres will and will not make
 * atomic. A class seat cannot be claimed by a conditional INSERT: under READ
 * COMMITTED a subquery summing `booking_claims` cannot see rows other
 * transactions have not committed yet, so twelve concurrent buyers all read the
 * same sum and eleven of them pass a ten-seat ceiling. The scenario caught
 * exactly that.
 *
 * The one shape that *is* atomic is a conditional UPDATE on the row holding the
 * count — Postgres re-reads it under its own lock and re-evaluates the WHERE
 * against the latest committed version. That is why `reserveStock` is safe, and
 * `products.stockQuantity` is that row for a product. A class has a capacity per
 * *slot*, so it needs a row per slot, which is all this is.
 *
 * `booking_claims` still carries a row per order, because releasing has to be
 * idempotent and per-order: the delete returns what it actually removed, and
 * only that many seats go back.
 */
export const bookingSlots = pgTable(
  "booking_slots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    seatsTaken: integer("seats_taken").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("booking_slots_key").on(t.productId, t.startsAt)],
);
