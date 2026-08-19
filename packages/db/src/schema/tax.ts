import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { shops } from "./shop";

/**
 * The compliance half Sailo can honestly own: where a seller is registered,
 * what they have taken in each place, and which countries they will not sell
 * into.
 *
 * None of this computes anybody's tax. Stripe Tax already does that on the
 * seller's own connected account, with their registrations and their liability
 * — spec 38 refused becoming a tax provider and that refusal stands. What is
 * here is bookkeeping over money Sailo already recorded, so that a seller who
 * has never heard of economic nexus finds out before a tax authority tells them.
 */

/**
 * Somewhere the seller says they are registered.
 *
 * What this changes depends on the mode, and the settings screen has to say so:
 * under `taxMode = 'stripe'` these rows are informational, because Stripe's own
 * registration list is what decides the rate; under `manual` a row's `rateBp`
 * may override the shop's flat rate for that country. A seller who adds a
 * registration and sees no rate change will otherwise file a bug.
 */
export const taxJurisdictions = pgTable(
  "tax_jurisdictions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /** ISO 3166-1 alpha-2, upper-cased on the way in. */
    country: text("country").notNull(),
    /**
     * US state, Canadian province — null when the registration is national.
     *
     * Null rather than an empty string, and the unique index below is built on
     * `coalesce(region, '')` for exactly that reason: Postgres treats two NULLs
     * as distinct in a unique index, so a plain one would let a seller add
     * Germany twice.
     */
    region: text("region"),

    registrationNumber: text("registration_number"),
    registeredOn: date("registered_on"),
    expiresOn: date("expires_on"),

    /**
     * A local rate for this place, in basis points, under `manual` mode only.
     *
     * Nullable and normally null: the shop's flat `taxRateBp` is what most
     * sellers want and what every existing order was charged at. Blank is not
     * zero here — a null means "use the shop rate" and a stored `0` means "this
     * place is zero-rated", and those are different instructions.
     */
    rateBp: integer("rate_bp"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("tax_jurisdictions_shop_idx").on(t.shopId),
    uniqueIndex("tax_jurisdictions_shop_place_key").on(
      t.shopId,
      t.country,
      sql`coalesce(${t.region}, '')`,
    ),
  ],
);

/**
 * Whether this shop sells into a country at all.
 *
 * A row exists only where the seller (or the monitor) has said something; the
 * absence of a row means "yes", which is what every shop meant before this
 * table existed.
 *
 * Enforcement is at checkout, server-side. A country missing from the picker is
 * a suggestion — the checkout is a server action and a hand-rolled POST carries
 * whatever the caller wants — so `createOrderIntent` refuses it as well.
 */
export const taxCountryRules = pgTable(
  "tax_country_rules",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    country: text("country").notNull(),

    salesEnabled: boolean("sales_enabled").default(true).notNull(),

    /**
     * The monitor turned this off, rather than the seller.
     *
     * Recorded because a seller who finds Germany missing from their own
     * checkout needs to know the panel did it and why — a switch that moves on
     * its own with no explanation is indistinguishable from a bug, and the
     * seller's first move would be to turn it back on without reading anything.
     */
    autoDisabledAt: timestamp("auto_disabled_at"),
    autoDisabledReason: text("auto_disabled_reason"),

    /**
     * The alert rungs already mailed for this place — `70`, `90`.
     *
     * The claim, and it is claimed in a conditional UPDATE with the rung in the
     * WHERE rather than read-then-written: two overlapping cron ticks otherwise
     * both see "not sent yet" and the seller gets the same warning twice.
     * Append-only in practice; a rung is never removed, so a seller who dips
     * back under 70% and climbs again is not re-warned about the same year.
     */
    alertedRungs: text("alerted_rungs").array().default([]).notNull(),
    /** Which year `alertedRungs` is about. A new year starts the count again. */
    alertedYear: integer("alerted_year"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.country] })],
);

/**
 * Paid revenue, folded per place per day.
 *
 * Every figure is a **sum of stored minor units** — `orders.tax_cents`,
 * `orders.subtotal_cents` — and never `rate × net`. The order carries what was
 * actually charged; recomputing from today's rate answers a different question
 * and will disagree with the invoice the buyer is holding and the return the
 * seller is filing. `orders.tax_cents` is a snapshot for exactly this reason.
 *
 * CURRENCY IS PART OF THE KEY, WHICH THE SPEC'S SKETCH DID NOT SAY
 *
 * Spec 38 keys this on (shop, country, region, day). A shop that changed its
 * own currency partway through a year would then have GBP and USD minor units
 * added into one bigint, and no reader could ever separate them again. The
 * conversion rule in the same spec — *"counted in the order's own currency …
 * convert at display time only"* — is only possible if the stored row still
 * knows which currency it is. So `currency` joins the key, and a shop that
 * never changed currency has exactly the rows the sketch describes.
 */
export const taxRevenueDaily = pgTable(
  "tax_revenue_daily",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    country: text("country").notNull(),
    /** `''` rather than null, so the primary key can include it. */
    region: text("region").default("").notNull(),
    day: date("day").notNull(),
    currency: text("currency").notNull(),

    /**
     * Net of tax, and net of what was refunded.
     *
     * `bigint` because this is a running total over years and an `integer`
     * column tops out at €21m in cents — reachable by a shop that succeeds,
     * and the failure would be an overflow on the one screen a seller opens to
     * work out what they owe.
     */
    netCents: bigint("net_cents", { mode: "number" }).default(0).notNull(),
    taxCents: bigint("tax_cents", { mode: "number" }).default(0).notNull(),
    /**
     * The B2C/B2B split, kept as two columns rather than one filtered later.
     *
     * Only sales to individuals move a threshold: selling to a registered
     * company in another country is generally the buyer's tax to account for.
     * A filter applied at read time is a filter somebody forgets, and the
     * threshold screen is the one place where forgetting it tells a seller they
     * are fine when they are not.
     */
    b2bNetCents: bigint("b2b_net_cents", { mode: "number" }).default(0).notNull(),
    orderCount: integer("order_count").default(0).notNull(),

    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.shopId, t.country, t.region, t.day, t.currency],
    }),
    // "This shop, this year" is what every tile and the report both ask.
    index("tax_revenue_daily_shop_day_idx").on(t.shopId, t.day),
  ],
);

export type TaxJurisdiction = typeof taxJurisdictions.$inferSelect;
export type TaxCountryRule = typeof taxCountryRules.$inferSelect;
export type TaxRevenueDay = typeof taxRevenueDaily.$inferSelect;
