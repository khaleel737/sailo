import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { shops } from "./shop";
import { products } from "./catalog";
import type { VisitBreakdownJson } from "./json-types";

/** Traffic, rolled-up daily counts, and the staff audit trail. */

export const visits = pgTable(
  "visits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "cascade",
    }),
    sessionId: text("session_id"),

    /** The full referring URL as the browser reported it. */
    referrer: text("referrer"),
    /** Just the host, for grouping: "instagram.com", "google.com". */
    referrerHost: text("referrer_host"),
    /**
     * How they arrived: direct | search | social | referral | campaign.
     * Derived once on write so the dashboard can group without re-parsing.
     */
    source: text("source"),

    // Campaign tagging, when the link carried UTM parameters.
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),

    // Geography, from the edge. Absent in local development.
    country: text("country"),
    region: text("region"),
    city: text("city"),

    /** mobile | tablet | desktop */
    device: text("device"),
    os: text("os"),
    browser: text("browser"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("visits_shop_idx").on(t.shopId),
    index("visits_created_idx").on(t.createdAt),
    // The dashboard breakdowns all filter by shop and date, then group.
    index("visits_shop_created_idx").on(t.shopId, t.createdAt),
  ],
);

/**
 * One row per shop per day, folded down from `visits`.
 *
 * Raw visits are the biggest table in the product by an order of magnitude —
 * a shop doing a hundred views a day writes more rows in a month than its
 * whole catalogue — and every dashboard reads the same thirty-day window over
 * and over. Rolling them up nightly turns that into a few dozen rows, and lets
 * the raw table be trimmed to a retention window without losing the history
 * the charts are drawn from.
 *
 * Uniques are counted per day. They can't be summed across days without
 * double-counting a returning visitor, which is why the dashboard's own
 * "unique visitors" figure still reads the raw window inside retention.
 */
export const visitDaily = pgTable(
  "visit_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /** UTC date, matching how the raw rows are bucketed. */
    day: timestamp("day").notNull(),
    visits: integer("visits").default(0).notNull(),
    uniqueVisitors: integer("unique_visitors").default(0).notNull(),
    /** Top dimensions for the day: { countries: {NG: 12}, sources: {...} }. */
    breakdown: jsonb("breakdown").$type<VisitBreakdownJson>().default({}).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("visit_daily_shop_day_key").on(t.shopId, t.day),
    index("visit_daily_shop_idx").on(t.shopId, t.day),
  ],
);

/**
 * Every change a staff member makes to someone else's account from /hq.
 *
 * Two people share this panel and both can comp a plan or take a shop down.
 * Without a record, "why is this account on Business?" has no answer a month
 * later. Append-only: nothing in the product deletes from here.
 */
export const staffActions = pgTable(
  "staff_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Who did it. The email, not a user id — it stays readable forever. */
    actorEmail: text("actor_email").notNull(),
    /** comp_plan | clear_comp | suspend | unsuspend | note */
    action: text("action").notNull(),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "cascade" }),
    /** Human sentence, written at the time: "Comped Business — beta tester". */
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("staff_actions_shop_idx").on(t.shopId),
    index("staff_actions_created_idx").on(t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Relations                                                                  */
/* -------------------------------------------------------------------------- */
