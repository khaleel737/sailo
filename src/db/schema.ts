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
    whatsapp: text("whatsapp"), // E.164 digits, no +
    contactEmail: text("contact_email"),
    location: text("location"),

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
 * An order here is an *intent* — captured the moment a buyer commits, just
 * before we hand them off to WhatsApp. The seller keeps the lead even if the
 * buyer never sends the message.
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

    // Snapshot so the record survives product edits/deletes.
    productTitle: text("product_title").notNull(),
    unitPriceCents: integer("unit_price_cents").default(0).notNull(),
    quantity: integer("quantity").default(1).notNull(),
    currency: text("currency").default("USD").notNull(),

    customerName: text("customer_name"),
    customerContact: text("customer_contact"),
    note: text("note"),

    channel: text("channel").default("whatsapp").notNull(),
    status: text("status").default("new").notNull(), // new | contacted | fulfilled | cancelled

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("orders_shop_idx").on(t.shopId),
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
}));

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ShopSocial = {
  platform: string;
  url: string;
};

export type Shop = typeof shops.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Visit = typeof visits.$inferSelect;
