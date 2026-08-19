import {
  boolean,
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
import { productFiles, products } from "./catalog";
import { orders } from "./orders";

/**
 * Ordered, gated, resumable content. Spec 40 — "courses", narrowly.
 *
 * `deferred/18-ecourse.md` was parked as not Sailo's product direction, and this
 * is not a reversal of that: a video player with a layout editor, transcoding and
 * DRM is a separate business with a separate cost base and it stays out. What is
 * here is the one row of that spec's table Sailo did not already have — grouping,
 * order, progress and a page — on top of four that it did:
 *
 *   files, ordered                     `product_files.position`
 *   delivery behind a gate             `/download/[token]`, hashed tokens
 *   entitlement decided at *read* time `membershipAccess`, `door_passes`
 *   recurring access, card and manual  `subscriptions.billingMode`
 *
 * ## It writes no new access predicate
 *
 * There is no `isUnlocked`, no `accessLevel` and no per-item entitlement column
 * anywhere in this file. `membershipAccess` is the single implementation of "may
 * this buyer see this", and that property is why grace periods, the members
 * list, the download gate, the door pass and cancellation all behave
 * consistently without five copies of the rule drifting apart. Gated content
 * asks the same question, so it asks the same function.
 *
 * The one exception is `isPreview`, and it is an exception to the *gate* rather
 * than a second implementation of it: a preview is readable without an order at
 * all, which is why it may never be a real file.
 */
export const collections = pgTable(
  "collections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    description: text("description"),

    /**
     * `none` | `interval`.
     *
     * Drip is **computed**, never stored: a stored unlock date is wrong the
     * moment a seller changes the interval, and wrong in the direction that
     * either withholds something a buyer paid for or releases it early.
     */
    dripMode: text("drip_mode").default("none").notNull(),
    dripIntervalDays: integer("drip_interval_days"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("collections_shop_product_idx").on(t.shopId, t.productId),
    /*
     * One collection per product in v1. A second would mean the buyer's delivery
     * page has to ask which one they want, and there is no screen in this spec
     * that asks anybody anything — the token resolves to an order, the order to
     * a product, the product to its collection.
     */
    uniqueIndex("collections_product_key").on(t.productId),
  ],
);

export const collectionItems = pgTable(
  "collection_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),

    /**
     * A label, not a table.
     *
     * A three-level hierarchy — course → module → lesson — needs a tree, an
     * editor and a traversal. A section label plus `position` renders the same
     * page and is one column. Promote it only if sellers ask for nested modules.
     */
    section: text("section"),

    /**
     * The file this item delivers, if it delivers one.
     *
     * Cascades: deleting a file makes the collection render shorter rather than
     * break, and the seller is told the count before they delete.
     */
    fileId: uuid("file_id").references(() => productFiles.id, { onDelete: "cascade" }),

    /**
     * An allowlisted embed.
     *
     * Goes through the SSRF guard **at the write**, never at render — the same
     * rule as every other seller-supplied URL, and the same four writes that had
     * to be fixed once already.
     */
    externalUrl: text("external_url"),

    title: text("title").notNull(),
    bodyMd: text("body_md"),
    position: integer("position").default(0).notNull(),

    /**
     * Readable without an order, which is how a seller shows lesson one for free.
     *
     * A preview is therefore **public**, and must never be a real file: a
     * "preview" that minted a download token would be a paid file given away.
     * Enforced at the write and again at the read, because this is the one place
     * in the feature where a mistake hands the goods over.
     */
    isPreview: boolean("is_preview").default(false).notNull(),

    /** Overrides the collection's drip interval for this item. */
    availableAfterDays: integer("available_after_days"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("collection_items_collection_idx").on(t.collectionId, t.position)],
);

/**
 * How far a buyer got.
 *
 * **Keyed on the order, not the buyer.** There are no buyer accounts
 * (`GAP-2026-08-easytools.md` §4.8): the order *is* the entitlement and the
 * download token already resolves to one. Keying on an email would let a shared
 * address read somebody else's progress — which is the whole of the privacy
 * surface this feature has.
 *
 * And that is also why there is nothing else on the row. A "who watched what,
 * when" table is a surveillance surface a link-in-bio seller has not asked for;
 * what a seller gets is a completion percentage on the members list they
 * already have.
 */
export const contentProgress = pgTable(
  "content_progress",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => collectionItems.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at"),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.itemId] }),
    index("content_progress_order_idx").on(t.orderId),
  ],
);
