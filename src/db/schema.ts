import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* -------------------------------------------------------------------------- */
/*  BetterAuth core tables                                                     */
/* -------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

/* -------------------------------------------------------------------------- */
/*  Sailo domain                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A shop is the single public page a user owns — the Linktree equivalent.
 * One shop per user keeps onboarding to a single step.
 */
export const shops = pgTable(
  "shops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // Public identity
    handle: text("handle").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    avatarUrl: text("avatar_url"),
    logoUrl: text("logo_url"),

    /** Default storefront language; a visitor's own choice overrides it. */
    locale: text("locale").default("en").notNull(),

    // Look & feel — one template, a few knobs
    accentColor: text("accent_color").default("#111111").notNull(),
    theme: text("theme").default("light").notNull(), // light | dark
    layout: text("layout").default("grid").notNull(), // grid | list

    // Contact / ordering
    currency: text("currency").default("USD").notNull(),
    contactEmail: text("contact_email"),
    location: text("location"),

    // Ask for a delivery address on physical products.
    collectAddress: boolean("collect_address").default(true).notNull(),

    // Affiliate programme
    affiliatesEnabled: boolean("affiliates_enabled").default(false).notNull(),
    /** Default commission in basis points — 1000 = 10%. */
    affiliateDefaultBp: integer("affiliate_default_bp").default(1000).notNull(),
    /** Let anyone apply to be an affiliate from the public page. */
    affiliatePublicSignup: boolean("affiliate_public_signup")
      .default(false)
      .notNull(),
    affiliateTerms: text("affiliate_terms"),

    // Billing — see lib/plans.ts for what each tier unlocks
    plan: text("plan").default("free").notNull(), // free | pro | business
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** Stripe's status verbatim: active, trialing, past_due, canceled… */
    subscriptionStatus: text("subscription_status"),
    subscriptionInterval: text("subscription_interval"), // month | year
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),

    /** Everything before this is treated as read in the notification tray. */
    notificationsReadAt: timestamp("notifications_read_at"),
    /** Individually dismissed notification ids. */
    dismissedNotifications: jsonb("dismissed_notifications")
      .$type<string[]>()
      .default([])
      .notNull(),

    // Invoicing
    invoicePrefix: text("invoice_prefix").default("INV").notNull(),
    invoiceNextNumber: integer("invoice_next_number").default(1).notNull(),
    invoiceNotes: text("invoice_notes"),

    // Tax. Off by default: most link-in-bio sellers are under a registration
    // threshold, and charging tax they don't owe is worse than not charging it.
    taxEnabled: boolean("tax_enabled").default(false).notNull(),
    /** What the buyer sees on the line: VAT, GST, Sales tax, IVA… */
    taxName: text("tax_name").default("Tax").notNull(),
    /** Basis points — 2000 = 20%. */
    taxRateBp: integer("tax_rate_bp").default(0).notNull(),
    /**
     * True where the law expects displayed prices to already include tax (the
     * EU, the UK, most of Asia); false where it's added at checkout (the US).
     */
    taxInclusive: boolean("tax_inclusive").default(false).notNull(),
    /** Shipping is taxable in most places, so this defaults on. */
    taxOnDelivery: boolean("tax_on_delivery").default(true).notNull(),
    /** VAT/GST registration number, printed on the invoice. */
    taxId: text("tax_id"),

    // [{ platform: 'instagram', url: '...' }, ...]
    socials: jsonb("socials").$type<ShopSocial[]>().default([]).notNull(),

    isPublished: boolean("is_published").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("shops_handle_key").on(t.handle),
    uniqueIndex("shops_user_id_key").on(t.userId),
    index("shops_stripe_customer_idx").on(t.stripeCustomerId),
    index("shops_stripe_subscription_idx").on(t.stripeSubscriptionId),
  ],
);

/**
 * Every Stripe event we've processed. The webhook is at-least-once, so this
 * makes replays a no-op instead of double-applying a plan change.
 */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    id: text("id").primaryKey(), // Stripe's event id
    type: text("type").notNull(),
    processedAt: timestamp("processed_at").defaultNow().notNull(),
  },
  (t) => [index("stripe_events_type_idx").on(t.type)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("categories_shop_slug_key").on(t.shopId, t.slug),
    index("categories_shop_idx").on(t.shopId),
  ],
);

/**
 * A product is anything the seller uploads — physical goods, a digital file,
 * or a service. The template renders all three identically.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),

    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),

    // Minor units (cents) to keep arithmetic exact.
    priceCents: integer("price_cents").default(0).notNull(),
    compareAtCents: integer("compare_at_cents"),

    kind: text("kind").default("physical").notNull(), // physical | digital | service
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),

    inStock: boolean("in_stock").default(true).notNull(),
    isFeatured: boolean("is_featured").default(false).notNull(),
    isPublished: boolean("is_published").default(true).notNull(),
    position: integer("position").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("products_shop_slug_key").on(t.shopId, t.slug),
    index("products_shop_idx").on(t.shopId),
    index("products_category_idx").on(t.categoryId),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: text("alt"),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    authorName: text("author_name").notNull(),
    rating: integer("rating").notNull(), // 1..5
    body: text("body"),
    isApproved: boolean("is_approved").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("reviews_product_idx").on(t.productId),
    index("reviews_shop_idx").on(t.shopId),
  ],
);

/**
 * The rails a shop offers at checkout. Contact rails hand off to a chat app,
 * manual rails settle out of band, and card rails (later) redirect to a
 * gateway the seller owns. Config shape varies per type — see PaymentConfig.
 */
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

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("affiliates_shop_code_key").on(t.shopId, t.code),
    index("affiliates_shop_idx").on(t.shopId),
  ],
);

/**
 * A buyer, owned by one shop. Created or matched on every order so repeat
 * buyers accumulate history instead of appearing as separate rows.
 */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),

    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country"),

    notes: text("notes"), // seller's private notes

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("clients_shop_idx").on(t.shopId),
    uniqueIndex("clients_shop_email_key").on(t.shopId, t.email),
    uniqueIndex("clients_shop_phone_key").on(t.shopId, t.phone),
  ],
);

/**
 * An order here is an *intent* — captured the moment a buyer commits, before
 * we hand them off to their chosen rail. The seller keeps the lead even if the
 * buyer never completes the handoff.
 *
 * Customer and product details are snapshotted so the record stays truthful
 * after a client edits their profile or a product is deleted.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),

    productTitle: text("product_title").notNull(),
    unitPriceCents: integer("unit_price_cents").default(0).notNull(),
    quantity: integer("quantity").default(1).notNull(),
    currency: text("currency").default("USD").notNull(),

    // Money breakdown: total = subtotal - discount + delivery
    subtotalCents: integer("subtotal_cents").default(0).notNull(),
    discountCents: integer("discount_cents").default(0).notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").default(0).notNull(),
    /**
     * Tax snapshot. The rate and name are copied from the shop at order time —
     * a rate change must never rewrite what a past buyer was charged, and an
     * invoice has to keep saying what it said when it was issued.
     */
    taxCents: integer("tax_cents").default(0).notNull(),
    taxRateBp: integer("tax_rate_bp").default(0).notNull(),
    taxName: text("tax_name"),
    /** True when `taxCents` is contained in the total rather than added to it. */
    taxInclusive: boolean("tax_inclusive").default(false).notNull(),
    totalCents: integer("total_cents").default(0).notNull(),

    // Delivery — id for reporting, snapshot so the record survives rate edits
    deliveryMethodId: uuid("delivery_method_id").references(
      () => deliveryMethods.id,
      { onDelete: "set null" },
    ),
    deliveryMethod: text("delivery_method"), // shipping | collection | null for digital
    deliveryLabel: text("delivery_label"),
    pickupLocation: text("pickup_location"),

    // Fulfilment
    trackingCarrier: text("tracking_carrier"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    shippedAt: timestamp("shipped_at"),

    // Refunds — excluded from revenue
    refundedCents: integer("refunded_cents").default(0).notNull(),
    refundedAt: timestamp("refunded_at"),
    refundReason: text("refund_reason"),

    // Email dispatch
    confirmationSentAt: timestamp("confirmation_sent_at"),

    // Coupon snapshot
    couponId: uuid("coupon_id").references(() => coupons.id, {
      onDelete: "set null",
    }),
    couponCode: text("coupon_code"),

    // Affiliate attribution
    affiliateId: uuid("affiliate_id").references(() => affiliates.id, {
      onDelete: "set null",
    }),
    affiliateCode: text("affiliate_code"),
    commissionCents: integer("commission_cents").default(0).notNull(),
    commissionPaid: boolean("commission_paid").default(false).notNull(),

    // Customer snapshot
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    customerPhone: text("customer_phone"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country"),
    note: text("note"),

    // How they chose to pay
    paymentMethod: text("payment_method").default("whatsapp").notNull(),
    paymentStatus: text("payment_status").default("unpaid").notNull(), // unpaid | pending | paid
    paymentReference: text("payment_reference"), // transfer ref the buyer typed
    paymentProofUrl: text("payment_proof_url"),

    // new | confirmed | shipped | completed | cancelled | refunded
    status: text("status").default("new").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("orders_shop_idx").on(t.shopId),
    index("orders_client_idx").on(t.clientId),
    index("orders_created_idx").on(t.createdAt),
  ],
);

/**
 * Issued per order with a per-shop sequential number. `token` backs a public
 * link so the buyer can view it without an account.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),

    number: text("number").notNull(), // e.g. INV-0007
    token: text("token").notNull(),

    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    sentAt: timestamp("sent_at"),
    sentTo: text("sent_to"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("invoices_token_key").on(t.token),
    uniqueIndex("invoices_shop_number_key").on(t.shopId, t.number),
    uniqueIndex("invoices_order_key").on(t.orderId),
    index("invoices_shop_idx").on(t.shopId),
  ],
);

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

/* -------------------------------------------------------------------------- */
/*  Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const shopsRelations = relations(shops, ({ one, many }) => ({
  owner: one(user, { fields: [shops.userId], references: [user.id] }),
  products: many(products),
  categories: many(categories),
  orders: many(orders),
  visits: many(visits),
  paymentMethods: many(paymentMethods),
  deliveryMethods: many(deliveryMethods),
  clients: many(clients),
  coupons: many(coupons),
  affiliates: many(affiliates),
  invoices: many(invoices),
}));

export const deliveryMethodsRelations = relations(deliveryMethods, ({ one }) => ({
  shop: one(shops, { fields: [deliveryMethods.shopId], references: [shops.id] }),
}));

export const couponsRelations = relations(coupons, ({ one, many }) => ({
  shop: one(shops, { fields: [coupons.shopId], references: [shops.id] }),
  orders: many(orders),
}));

export const affiliatesRelations = relations(affiliates, ({ one, many }) => ({
  shop: one(shops, { fields: [affiliates.shopId], references: [shops.id] }),
  orders: many(orders),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  shop: one(shops, { fields: [invoices.shopId], references: [shops.id] }),
  order: one(orders, { fields: [invoices.orderId], references: [orders.id] }),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({ one }) => ({
  shop: one(shops, { fields: [paymentMethods.shopId], references: [shops.id] }),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  shop: one(shops, { fields: [clients.shopId], references: [shops.id] }),
  orders: many(orders),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  shop: one(shops, { fields: [categories.shopId], references: [shops.id] }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  shop: one(shops, { fields: [products.shopId], references: [shops.id] }),
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  images: many(productImages),
  reviews: many(reviews),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  product: one(products, {
    fields: [reviews.productId],
    references: [products.id],
  }),
  shop: one(shops, { fields: [reviews.shopId], references: [shops.id] }),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  shop: one(shops, { fields: [orders.shopId], references: [shops.id] }),
  deliveryRate: one(deliveryMethods, {
    fields: [orders.deliveryMethodId],
    references: [deliveryMethods.id],
  }),
  product: one(products, {
    fields: [orders.productId],
    references: [products.id],
  }),
  client: one(clients, {
    fields: [orders.clientId],
    references: [clients.id],
  }),
  coupon: one(coupons, {
    fields: [orders.couponId],
    references: [coupons.id],
  }),
  affiliate: one(affiliates, {
    fields: [orders.affiliateId],
    references: [affiliates.id],
  }),
  invoice: one(invoices, {
    fields: [orders.id],
    references: [invoices.orderId],
  }),
}));

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ShopSocial = {
  platform: string;
  url: string;
};

/** Union of every rail's settings — only the keys for that type are used. */
export type PaymentConfig = {
  // Contact rails
  phone?: string; // whatsapp, phone
  username?: string; // telegram, instagram
  address?: string; // email
  // Bank transfer
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  iban?: string;
  swift?: string;
  // Free text shown to the buyer after ordering (bank_transfer, cod)
  instructions?: string;
};

/** Union of every delivery type's settings. */
export type DeliveryConfig = {
  /** shipping: "2–3 working days" */
  estimate?: string;
  /** collection: where to pick up */
  address?: string;
  /** collection: opening hours */
  hours?: string;
  instructions?: string;
};

export type Shop = typeof shops.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type DeliveryMethod = typeof deliveryMethods.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type Affiliate = typeof affiliates.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
