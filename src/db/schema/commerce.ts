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
import type { DeliveryConfig, PaymentConfig } from "./json-types";

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
    config: jsonb("config").$type<DeliveryConfig>().default({}).notNull(),

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
