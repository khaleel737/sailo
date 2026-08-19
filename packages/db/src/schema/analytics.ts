import {
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
import type { VisitBreakdownJson } from "./json-types";

/** Traffic, rolled-up daily counts, and the staff audit trail. */

/**
 * PARTITIONED BY MONTH ON `created_at`.
 *
 * Drizzle has no way to say that, so the partitioning lives in
 * `scripts/partition-visits.ts` and `lib/visit-partitions.ts` and this
 * declaration describes the shape rather than the storage. Two consequences
 * worth knowing before editing:
 *
 *   - The primary key is `(id, created_at)`, not `id`. A partitioned table's
 *     key must contain the partition key, because a uuid alone cannot be proven
 *     unique across partitions the planner never reads. Changing it back here
 *     makes `npm run db:push` try to change it back there.
 *   - The monthly children live in a separate `visits_parts` schema, out of
 *     `db:push`'s sight — it offers to drop anything in `public` it does not find
 *     in this file.
 */
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").defaultRandom().notNull(),
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
    primaryKey({ columns: [t.id, t.createdAt] }),
    index("visits_shop_idx").on(t.shopId),
    index("visits_created_idx").on(t.createdAt),
    // The dashboard breakdowns all filter by shop and date, then group.
    index("visits_shop_created_idx").on(t.shopId, t.createdAt),
  ],
);

/** Where an outbound click may point, by the surface that carried the link. */
export const CLICK_KINDS = [
  "social",
  "product_link",
  "contact",
  "other",
] as const;
export type ClickKind = (typeof CLICK_KINDS)[number];

/**
 * One outbound click — a visitor leaving the storefront through a link the
 * seller put there: a social icon, a contact handoff, an external product.
 *
 * Only the host is stored, never the full URL. A destination URL can carry the
 * buyer's own data in its query string — a prefilled WhatsApp message is the
 * whole order — and "where do my customers go" is answered by the host alone.
 *
 * A plain table, unlike `visits`: clicks are an order of magnitude rarer than
 * pageviews (most views click nothing), so the partitioning machinery would
 * cost more than the rows. Revisit only if `check:load` says so.
 */
export const clicks = pgTable(
  "clicks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    /** Host only, punycoded as the URL parser hands it over. */
    targetHost: text("target_host").notNull(),
    /** Which surface carried the link — see CLICK_KINDS. */
    kind: text("kind").default("other").notNull(),
    /** The same derived, never-stored visitor id `visits` uses. */
    sessionId: text("session_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // The dashboard asks "this shop, this window", the same shape as visits.
  (t) => [index("clicks_shop_created_idx").on(t.shopId, t.createdAt)],
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
    breakdown: jsonb("breakdown")
      .$type<VisitBreakdownJson>()
      .default({})
      .notNull(),

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
    /**
     * comp_plan | clear_comp | suspend | unsuspend | note | support_close |
     * revoke_session | revoke_sessions | clear_two_factor | revoke_api_key
     *
     * The security four are here for the same reason as the rest and then some:
     * clearing a second factor makes an account easier to get into, and the row
     * naming who did it and why is the only thing separating that from the
     * attack it would otherwise look exactly like.
     */
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

/**
 * A public link to one number.
 *
 * **The most dangerous thing in spec 42**, and every column is one of the
 * rules that makes it safe. A seller sharing a revenue chart with a partner or
 * a landlord is a real use; a public URL rendering a shop's revenue is a real
 * hazard, and the difference is entirely in the constraints.
 *
 * **The token is hashed**, like `apiKeys`: a dump of this table is not a set of
 * working links. **`expiresAt` is not null** — a link that never expires is a
 * permanent public revenue feed, and "they can revoke it" is no answer for one
 * a seller forgot they made. And **`metric` and `range` live on the row, not
 * in the URL**: one number and one fixed window per token, so nobody can edit
 * a link into a different figure or a wider period, because neither is a
 * parameter.
 *
 * There is no `dashboard` value for `metric` and there must not be one.
 */
export const analyticsShares = pgTable(
  "analytics_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /** One of `SHARE_METRICS`. Aggregates only. */
    metric: text("metric").notNull(),
    /** One of `SHARE_RANGES`, fixed at creation. */
    range: text("range").notNull(),

    tokenHash: text("token_hash").notNull(),
    /** The leading characters, so the settings list can name a link. Not a secret. */
    tokenPrefix: text("token_prefix").notNull(),

    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),

    /**
     * Who made it.
     *
     * An address rather than a user id, and deliberately: staff change, and
     * the question a seller asks a year later is "who shared our revenue" —
     * which a deleted account should not be able to erase.
     */
    createdByEmail: text("created_by_email"),
    lastViewedAt: timestamp("last_viewed_at"),
    viewCount: integer("view_count").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /* The public route's only lookup. Unique, because two rows with one hash
       would be two shops behind one link. */
    uniqueIndex("analytics_shares_token_hash_key").on(t.tokenHash),
    index("analytics_shares_shop_idx").on(t.shopId, t.createdAt),
  ],
);
