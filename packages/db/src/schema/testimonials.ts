import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { shops } from "./shop";
import { products } from "./catalog";
import { clients } from "./orders";

/**
 * Social proof about the *seller* — spec 35.
 *
 * WHY THIS IS NOT `reviews`, ASKED AGAIN AND ANSWERED THE SAME WAY
 *
 * `reviews` is `(shopId, productId, authorName, rating 1..5, body, isApproved)`.
 * It answers "what do buyers think of this product", renders on the product
 * page, and is correct as it stands. A testimonial answers "should I trust this
 * seller": shop-scoped, unrated, carrying an avatar and sometimes a video,
 * *solicited* by a link rather than volunteered, and rendered in two places a
 * review never is — the checkout, and a third party's website through an
 * iframe.
 *
 * Building it as a `productId`-null review would put an unrated, embeddable,
 * externally-served object inside the query that renders product pages — and
 * that query is `"use cache"` + `cacheTag(shopTag(shopId))`. One table, two
 * audiences, two cache lifetimes, one leak away from a draft testimonial on a
 * public page.
 */

/**
 * A named collection, and the thing an embed key points at.
 *
 * A shop can have several — one for the storefront, one for a landing page
 * elsewhere — but a testimonial does not need one: `wall_id` is nullable so a
 * seller can collect first and arrange later, and so deleting a wall throws
 * away the arrangement rather than the content.
 */
export const testimonialWalls = pgTable(
  "testimonial_walls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    slug: text("slug").notNull(),
    headline: text("headline"),
    layout: text("layout").default("grid").notNull(), // grid | carousel
    isPublished: boolean("is_published").default(false).notNull(),

    /**
     * The embed's whole address, and deliberately not the shop id or handle.
     *
     * A guessable key is an enumeration of every shop's marketing copy: the
     * embed is public, unauthenticated and served from its own route, so the
     * key *is* the authorisation. Opaque and rotatable — rotating it is what
     * takes a wall off a site the seller no longer controls, which is the only
     * revocation an iframe somebody else pasted can have.
     */
    embedKey: text("embed_key").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("testimonial_walls_shop_slug_key").on(t.shopId, t.slug),
    uniqueIndex("testimonial_walls_embed_key").on(t.embedKey),
  ],
);

export const testimonials = pgTable(
  "testimonials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    /** Null until arranged, and null again if the wall is deleted. */
    wallId: uuid("wall_id").references(() => testimonialWalls.id, {
      onDelete: "set null",
    }),
    /** Nullable: a testimonial can be about the shop rather than a thing. */
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),

    authorName: text("author_name").notNull(),
    authorRole: text("author_role"),
    /**
     * Guarded at the **write**, against the image allowlist, never at render.
     *
     * `PRODUCTION-PLAN.md` §2 item 2 is this bug in four other places:
     * `lib/og.tsx` fetching whatever URL it was handed from a public,
     * unauthenticated route. This is a fifth surface and the guard belongs
     * where the value arrives.
     */
    authorAvatarUrl: text("author_avatar_url"),
    body: text("body"),
    /**
     * A URL on an allowlisted embed host, never an upload.
     *
     * Storing video in Blob is a bandwidth bill and a moderation surface for a
     * feature that does not need either. Allowlisted to YouTube and Vimeo and
     * rendered as a sandboxed iframe on their own domain — an arbitrary
     * `<iframe src>` from seller input on a page a third party embeds is a
     * chain of two untrusted parties, and neither of them is the visitor.
     */
    videoUrl: text("video_url"),

    /** `requested | manual | imported` — how it got here. */
    source: text("source").default("manual").notNull(),
    /**
     * Who wrote it, while we still know.
     *
     * `set null` on delete, and the author's name stays: they typed it, and a
     * seller relying on published marketing must not have it vanish because a
     * contact was erased. What must stop is *attribution* — the link back to a
     * person's record — which is exactly what this column is.
     */
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),

    /** Nothing is public until a person approves it — same rule as `reviews`. */
    isApproved: boolean("is_approved").default(false).notNull(),
    isFeatured: boolean("is_featured").default(false).notNull(),
    position: integer("position").default(0).notNull(),

    submittedAt: timestamp("submitted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // The one question every public surface asks: this shop, approved, in order.
    index("testimonials_shop_approved_idx").on(t.shopId, t.isApproved, t.position),
    index("testimonials_wall_idx").on(t.wallId),
  ],
);

/**
 * An invitation to write one.
 *
 * The token is **hashed**, the rule `door_passes`, the API keys and the data
 * request tokens already follow: it is a bearer credential that writes a row on
 * a seller's shop, and a database read must not hand out live ones.
 */
export const testimonialRequests = pgTable(
  "testimonial_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),

    sentAt: timestamp("sent_at").defaultNow().notNull(),
    /** Set once, and the reason a used link cannot be used twice. */
    submittedAt: timestamp("submitted_at"),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [
    uniqueIndex("testimonial_requests_token_key").on(t.tokenHash),
    index("testimonial_requests_shop_sent_idx").on(t.shopId, t.sentAt),
  ],
);

export type Testimonial = typeof testimonials.$inferSelect;
export type TestimonialWall = typeof testimonialWalls.$inferSelect;
export type TestimonialRequest = typeof testimonialRequests.$inferSelect;
