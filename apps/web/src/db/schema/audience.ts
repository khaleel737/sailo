import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shop";
import { clients } from "./orders";
import { coupons } from "./commerce";
import type { SegmentFilter } from "./json-types";

/**
 * Marketing email: what a seller wrote, who it went to, and who may never be
 * written to again.
 *
 * Its own file because it is the one part of the schema whose constraints are
 * legal rather than commercial. Everything else here protects money; these
 * three tables protect the fact that a person said yes and can say no.
 */

/**
 * One broadcast a seller composed and sent.
 *
 * `audienceTag` was the whole audience model in v1 — one optional tag, or
 * everyone. It is kept, not dropped, because rows written under it are the
 * record of who a past send actually went to, and rewriting them into the
 * newer shape would be inventing history. New drafts write `audienceFilter`;
 * `lib/broadcasts/segments.ts` reads the tag as a one-rule filter when the
 * jsonb is absent, so both eras answer the same question.
 */
export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    subject: text("subject").notNull(),
    /**
     * The line an inbox shows under the subject.
     *
     * Seller-authored because the fallback — the subject, repeated — wastes
     * the one piece of copy that decides whether a marketing email is opened
     * at all. Blank falls back, which is why it is nullable rather than
     * defaulted to the subject at write time: a default would freeze the
     * subject as it read when the draft was saved.
     */
    previewText: text("preview_text"),
    /** Seller-authored, rendered through the transactional email's own markup. */
    bodyMarkdown: text("body_markdown").notNull(),

    /** draft | scheduled | queuing | sending | sent. */
    status: text("status").default("draft").notNull(),

    /** v1's audience: null meant every consented contact. Read as a fallback. */
    audienceTag: text("audience_tag"),
    /**
     * The audience as a question — see `SegmentFilter`.
     *
     * Null is "everyone who consented", the same as an empty rule list, and
     * both are spelled out in `parseSegment` rather than assumed at each call
     * site: a filter that fails open to a *smaller* audience silently mails
     * the wrong people, and one that fails open to a larger one mails people
     * the seller excluded on purpose. Neither is allowed to be an accident.
     */
    audienceFilter: jsonb("audience_filter").$type<SegmentFilter>(),

    /**
     * How many rows were queued when the send began.
     *
     * Stored rather than counted at render time so a partial send is visibly
     * partial: "412 of 900" needs both numbers, and the second one stops
     * being derivable the moment a delivery row is cascaded away.
     */
    recipientCount: integer("recipient_count").default(0).notNull(),

    /* ----------------------------------------------------------------------
       The promotion

       A marketing email whose only call to action is "read this" converts
       like one. These three are what turns a written message into an offer:
       a code, the things it applies to, and a button. All optional — a shop
       announcing a closure has an offer for nobody.
    ---------------------------------------------------------------------- */

    /**
     * The discount this message is about.
     *
     * A reference and not a copy of the code, so the terms rendered into the
     * email are the coupon's own — a seller who edits the expiry the morning
     * after sending has not left a lie in nine hundred inboxes, because the
     * send reads the row. `set null` on delete: a deleted coupon leaves a
     * broadcast that no longer promises anything, which is the honest
     * outcome; the alternative would cascade away the record of the send.
     */
    couponId: uuid("coupon_id").references(() => coupons.id, {
      onDelete: "set null",
    }),
    /**
     * Products to show as cards under the body — a drop, a category's new
     * arrivals, the three things the discount is for.
     *
     * Ids, resolved at send time for the same reason the coupon is: price,
     * title and photo must be what they are when the email goes out, not
     * what they were when the draft was saved. Missing products simply do not
     * render, so a deleted one leaves a shorter email rather than a broken
     * card.
     */
    productIds: jsonb("product_ids").$type<string[]>().default([]).notNull(),

    /** The button's words. Blank uses the dictionary's default. */
    ctaLabel: text("cta_label"),
    /**
     * Where the button goes. Blank points at the shop's own front page —
     * which is the right default and the reason this is nullable rather than
     * required: the most common campaign wants the storefront, and making a
     * seller paste their own URL to get it invites a typo into every inbox.
     */
    ctaUrl: text("cta_url"),

    /**
     * When a scheduled send becomes due.
     *
     * The cron promotes it; nothing about the send path knows it was
     * scheduled. Kept after the promotion as the record of what was asked
     * for — "sent at 09:04 because it was scheduled for 09:00" is a question
     * a seller asks exactly once, on the morning it looks wrong.
     */
    scheduledAt: timestamp("scheduled_at"),

    startedAt: timestamp("started_at"),
    sentAt: timestamp("sent_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("broadcasts_shop_idx").on(t.shopId, t.createdAt),
    // The send pass asks the fleet-wide question "what is mid-flight".
    index("broadcasts_status_idx").on(t.status),
    // And the scheduler asks the narrower one: what is due, across the fleet.
    index("broadcasts_due_idx").on(t.status, t.scheduledAt),
  ],
);

/**
 * One row per address, written before anything is sent.
 *
 * The audit trail, and more importantly the resume point: a crash between
 * batches leaves `queued` rows and the next tick picks those up, rather than
 * starting the broadcast again from a list it would rebuild identically.
 *
 * `email` is snapshotted rather than read back through `clientId`, because
 * the address that was mailed is a fact and the client's current address is a
 * different fact. `shopId` rides along because the daily quota and the
 * suppression check are both shop-scoped questions, and a join to ask them is
 * a join some future call site will forget.
 */
export const broadcastDeliveries = pgTable(
  "broadcast_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    broadcastId: uuid("broadcast_id")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),

    email: text("email").notNull(),
    /** queued | sending | sent | failed | suppressed — see `lib/broadcasts/send`. */
    status: text("status").default("queued").notNull(),
    /** Resend's id, so a delivery question has something to look up. */
    providerId: text("provider_id"),
    error: text("error"),
    attempts: integer("attempts").default(0).notNull(),

    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * One address is mailed once per broadcast, decided by Postgres rather
     * than by the loop that builds the queue. Two clients sharing an address,
     * a retried enqueue, a seller pressing Send twice — all collide here.
     */
    uniqueIndex("broadcast_deliveries_target_key").on(t.broadcastId, t.email),
    index("broadcast_deliveries_queue_idx").on(t.broadcastId, t.status),
    index("broadcast_deliveries_shop_sent_idx").on(t.shopId, t.sentAt),
  ],
);

/**
 * Addresses this shop may never mail again, whatever any consent column says.
 *
 * Deliberately not a flag on `clients`. Consent is about a person the seller
 * knows; suppression is about an address, and the two come apart exactly
 * where it matters — an unsubscribe arrives from a mail client with no
 * session and no client id, a bounce arrives from Resend naming only an
 * address, and both must stick even if that person later places another order
 * and ticks the opt-in box again. A `clients` row can be deleted; the
 * promise not to mail somebody cannot be.
 */
export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** unsubscribed | bounced | complained — see `SUPPRESSION_REASONS`. */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * Unsubscribing twice is not an error, and the second click must not fail
     * in front of somebody already annoyed enough to be clicking it.
     */
    uniqueIndex("email_suppressions_shop_email_key").on(t.shopId, t.email),
  ],
);
