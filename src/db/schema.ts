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
/*  Shopik domain                                                              */
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

    // [{ platform: 'instagram', url: '...' }, ...]
    socials: jsonb("socials").$type<ShopSocial[]>().default([]).notNull(),

    isPublished: boolean("is_published").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("shops_handle_key").on(t.handle),
    uniqueIndex("shops_user_id_key").on(t.userId),
  ],
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

    status: text("status").default("new").notNull(), // new | confirmed | fulfilled | cancelled

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("orders_shop_idx").on(t.shopId),
    index("orders_client_idx").on(t.clientId),
    index("orders_created_idx").on(t.createdAt),
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
    referrer: text("referrer"),
    country: text("country"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("visits_shop_idx").on(t.shopId),
    index("visits_created_idx").on(t.createdAt),
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
  clients: many(clients),
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
  product: one(products, {
    fields: [orders.productId],
    references: [products.id],
  }),
  client: one(clients, {
    fields: [orders.clientId],
    references: [clients.id],
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

export type Shop = typeof shops.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type Client = typeof clients.$inferSelect;
