import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shop";
import type { ProductOption, VariantOptions } from "./json-types";

/** What a shop sells: categories, products, their variants, files and reviews. */

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
 * or a service. The template renders all three identically; what differs is
 * how the order is fulfilled, which the `kind`-specific columns below drive.
 *
 * The price here is the product's base. A product with options prices each
 * combination in `productVariants` and falls back to this when one is blank.
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

    /**
     * What the buyer chooses between: [{ name: "Size", values: ["S","M","L"] }].
     * Empty for a product sold as one thing. The sellable combinations live in
     * `productVariants` — this is only the shape of the choice.
     */
    options: jsonb("options").$type<ProductOption[]>().default([]).notNull(),

    /**
     * Count units down as orders arrive instead of relying on the manual
     * `inStock` switch. Stock lives on the variant when there are options.
     */
    trackInventory: boolean("track_inventory").default(false).notNull(),
    /** Units left, for a product with no options. Null while untracked. */
    stockQuantity: integer("stock_quantity"),

    // Digital goods
    /**
     * Hold the files until the seller confirms payment. On by default: every
     * rail here settles out of band, so releasing on order would hand the file
     * to anyone willing to click through checkout.
     */
    releaseOnPayment: boolean("release_on_payment").default(true).notNull(),
    /** Downloads allowed per order. Null is unlimited. */
    downloadLimit: integer("download_limit"),
    /** Days the buyer's link stays alive. Null never expires. */
    downloadExpiryDays: integer("download_expiry_days"),

    // Services
    durationMinutes: integer("duration_minutes"),
    serviceMode: text("service_mode").default("in_person").notNull(), // in_person | online
    /** Where to turn up, or how the call is joined. */
    serviceLocation: text("service_location"),
    /** Ask the buyer for a preferred date and time at checkout. */
    bookingEnabled: boolean("booking_enabled").default(false).notNull(),
    /** Notice the seller needs — the picker won't offer anything sooner. */
    bookingLeadHours: integer("booking_lead_hours").default(24).notNull(),

    // Events
    /**
     * When the doors open, for `kind: "event"`. This is the moment ticket
     * sales close: a ticket sold after the start would be one for an event
     * already happening. Venue reuses `serviceLocation` above, and capacity
     * is ordinary stock — the guarded decrement is what stops overselling
     * a room, exactly as it stops overselling a shelf.
     */
    eventStartsAt: timestamp("event_starts_at"),

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
    /**
     * The storefront's default order, batched. Without this a deep catalogue
     * sorts the whole published set on every batch, so the last batch costs
     * more than the first — which is the cost the batching exists to remove.
     */
    index("products_shop_browse_idx").on(
      t.shopId,
      t.isPublished,
      t.isFeatured,
      t.position,
      t.createdAt,
      t.id,
    ),
  ],
);

/**
 * One sellable combination of a product's options — the medium pizza, the red
 * shirt in large. Price, stock and SKU are per-variant; a blank price means
 * "same as the product", so a shirt that costs the same in every colour needs
 * no numbers typed at all.
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /** One value per product option: { Size: "Large", Colour: "Red" }. */
    options: jsonb("options").$type<VariantOptions>().default({}).notNull(),

    sku: text("sku"),
    /** Null falls back to the product's price. */
    priceCents: integer("price_cents"),
    compareAtCents: integer("compare_at_cents"),
    /** Units left. Null while the product isn't tracking inventory. */
    stockQuantity: integer("stock_quantity"),
    /** The seller's manual switch for this combination alone. */
    isAvailable: boolean("is_available").default(true).notNull(),
    /** Swapped into the gallery when this combination is picked. */
    imageUrl: text("image_url"),

    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("product_variants_product_idx").on(t.productId)],
);

/**
 * A file a digital product delivers. Buyers never see these URLs — the
 * download route streams the bytes behind a per-order token.
 */
export const productFiles = pgTable(
  "product_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    url: text("url").notNull(),
    sizeBytes: integer("size_bytes"),
    contentType: text("content_type"),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("product_files_product_idx").on(t.productId)],
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
