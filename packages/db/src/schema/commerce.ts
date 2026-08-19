import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shop";
import type {
  CurrencyPrices,
  DeliveryConfig,
  PaymentConfig,
  WeightBand,
} from "./json-types";

/** How a shop takes money and gets goods to people, plus who refers buyers. */

export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    type: text("type").notNull(), // see PAYMENT_METHOD_TYPES
    label: text("label"), // seller override for the button text
    config: jsonb("config").$type<PaymentConfig>().default({}).notNull(),

    isEnabled: boolean("is_enabled").default(true).notNull(),
    position: integer("position").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("payment_methods_shop_type_key").on(t.shopId, t.type),
    index("payment_methods_shop_idx").on(t.shopId),
  ],
);

/**
 * How the buyer receives the order. Mirrors paymentMethods: sellers enable the
 * ones they offer, the buyer picks one at checkout.
 */
export const deliveryMethods = pgTable(
  "delivery_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    type: text("type").notNull(), // shipping | collection
    /** Shown to the buyer — "Standard", "Express", "Next day", "Pickup". */
    name: text("name").notNull(),
    feeCents: integer("fee_cents").default(0).notNull(),
    /** Orders at or above this subtotal ship free. Null disables the rule. */
    freeOverCents: integer("free_over_cents"),

    /**
     * What this costs in the other currencies the shop quotes.
     *
     * `{ "EUR": { "price": 2500, "secondary": 3000 } }` — minor units in
     * *that* currency, decided by `currencyDecimals` and never by a flat 100.
     * `price` is the fee charged; `secondary` is the free-over threshold, if this rate has one.
     *
     * Every number in here was typed by the seller. Nothing converts anything:
     * see `docs/specs/53-regional-pricing.md`. An absent currency is not a zero
     * and not a fallback — it is what makes that currency **not offered at
     * all**, which is the only safe answer when nobody has said what the price
     * should be.
     *
     * `{}` is the default and is what every existing row means.
     */
    currencyPrices: jsonb("currency_prices")
      .$type<CurrencyPrices>()
      .default({})
      .notNull(),
    config: jsonb("config").$type<DeliveryConfig>().default({}).notNull(),

    /**
     * Whether this rate is one price or a table of them — spec 51.
     *
     * `flat` is `feeCents`, which is every rate ever saved here. `by_weight`
     * reads `weightBands` below and charges by what is actually in the box —
     * the input `0019`'s per-country zones were missing, because a rate could
     * not vary by weight when nothing recorded weight.
     */
    rateMode: text("rate_mode").default("flat").notNull(), // flat | by_weight
    /**
     * `[{ upToGrams: 500, priceCents: 350 }, …]`, cheapest first.
     *
     * A seller-configured table rather than a live carrier API, and that is the
     * deliberate trade: bands reach every carrier in every country, need no
     * credential at rest, and cannot go down mid-checkout. A seller can also
     * reason about them — they know what a 2 kg parcel costs because they have
     * posted one.
     *
     * A basket heavier than the last band makes this rate **unavailable**
     * rather than falling back to the top price: undercharging silently is the
     * seller's money, and `resolveDelivery` already has the vocabulary for a
     * rate that cannot be had. An empty table under `by_weight` falls back to
     * `feeCents`, because that is the half-configured state a seller passes
     * through on the way and it must not take their shop down.
     */
    weightBands: jsonb("weight_bands").$type<WeightBand[]>().default([]).notNull(),

    /**
     * Where this rate reaches: ISO 3166-1 alpha-2, uppercase.
     *
     * **Empty means anywhere**, not nowhere. That is what every row written
     * before this column existed meant, so the default is the whole backfill —
     * but it is also the one thing a reader can get backwards, and getting it
     * backwards stops a shop selling. Every site that reads this says so.
     *
     * Expanded codes, never a group token. Storing "EU" would mean the day a
     * country joins or leaves, every rate ever saved silently changes what it
     * promised — including on orders already placed.
     *
     * A text array rather than jsonb for the same reason `clients.tags` is
     * one: the question asked of it is containment, which Postgres answers
     * natively. There is no index because the containment test happens in
     * `lib/delivery.ts` over the handful of rates one shop has, not in SQL.
     *
     * Only `shipping` carries one. Collection is a pickup at a fixed address,
     * so where the buyer lives is not the seller's business — `saveDeliveryMethod`
     * writes `{}` for it whatever the form says.
     */
    countries: text("countries").array().default([]).notNull(),

    isEnabled: boolean("is_enabled").default(true).notNull(),
    position: integer("position").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  // No unique key on type — a shop can offer several shipping rates.
  (t) => [index("delivery_methods_shop_idx").on(t.shopId)],
);

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    code: text("code").notNull(), // stored uppercase
    discountType: text("discount_type").default("percent").notNull(), // percent | fixed
    /** Basis points when percent (1000 = 10%), minor units when fixed. */
    discountValue: integer("discount_value").notNull(),

    minSubtotalCents: integer("min_subtotal_cents").default(0).notNull(),

    /**
     * What this costs in the other currencies the shop quotes.
     *
     * `{ "EUR": { "price": 2500, "secondary": 3000 } }` — minor units in
     * *that* currency, decided by `currencyDecimals` and never by a flat 100.
     * `price` is the amount taken off, on a `fixed` coupon — a `percent` coupon
     * needs no entry at all, because a percentage is currency-free; `secondary` is the minimum subtotal that qualifies.
     *
     * Every number in here was typed by the seller. Nothing converts anything:
     * see `docs/specs/53-regional-pricing.md`. An absent currency is not a zero
     * and not a fallback — it is what makes that currency **not offered at
     * all**, which is the only safe answer when nobody has said what the price
     * should be.
     *
     * `{}` is the default and is what every existing row means.
     */
    currencyPrices: jsonb("currency_prices")
      .$type<CurrencyPrices>()
      .default({})
      .notNull(),
    maxRedemptions: integer("max_redemptions"),
    timesRedeemed: integer("times_redeemed").default(0).notNull(),

    startsAt: timestamp("starts_at"),
    expiresAt: timestamp("expires_at"),
    isActive: boolean("is_active").default(true).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("coupons_shop_code_key").on(t.shopId, t.code),
    index("coupons_shop_idx").on(t.shopId),
  ],
);

/**
 * Someone who earns commission for referring buyers. `code` is what appears in
 * a `?ref=` link; a per-affiliate rate overrides the shop default when set.
 */
export const affiliates = pgTable(
  "affiliates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    email: text("email"),
    code: text("code").notNull(), // stored uppercase

    /** Null falls back to shops.affiliateDefaultBp. */
    commissionBp: integer("commission_bp"),

    status: text("status").default("active").notNull(), // pending | active | disabled
    /** Set when a buyer opts into refer-and-earn after ordering. */
    source: text("source").default("manual").notNull(), // manual | signup | buyer

    clicks: integer("clicks").default(0).notNull(),
    payoutNotes: text("payout_notes"),

    /**
     * Where their money goes — set by the affiliate on their portal, read by
     * the seller next to what they owe. Distinct from `payoutNotes`, which is
     * the seller talking to themselves.
     *
     * `payoutUpdatedAt` is the audit trail for the one field an attacker with
     * a leaked portal link would want to change: every change stamps it and
     * mails the affiliate, so a silent redirection of money has a witness.
     */
    payoutMethod: text("payout_method"), // see PAYOUT_METHOD_TYPES in lib/payouts
    payoutDetails: text("payout_details"),
    payoutUpdatedAt: timestamp("payout_updated_at"),

    /**
     * Unguessable key to the affiliate's own report page.
     *
     * `code` can't do this job — it's the thing that appears in every `?ref=`
     * link they share, so anyone who clicked one would be able to read their
     * earnings. Issued on demand and rotatable without breaking their links.
     */
    portalToken: text("portal_token"),
    portalSeenAt: timestamp("portal_seen_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("affiliates_shop_code_key").on(t.shopId, t.code),
    index("affiliates_shop_idx").on(t.shopId),
    uniqueIndex("affiliates_portal_token_key").on(t.portalToken),
    // The portal signs in by email across every shop at once.
    index("affiliates_email_idx").on(t.email),
  ],
);

/**
 * A buyer, owned by one shop. Created or matched on every order so repeat
 * buyers accumulate history instead of appearing as separate rows.
 */
