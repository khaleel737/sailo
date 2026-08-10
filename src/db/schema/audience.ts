import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shop";
import { clients } from "./orders";

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
 * `audienceTag` is a nullable text column and not the jsonb filter object the
 * spec sketched. v1 offers exactly two audiences — everyone consented, or
 * everyone consented carrying one tag — and a jsonb blob holding one optional
 * string is a general shape pretending to a generality the code does not
 * have. A second dimension can add a column.
 */
export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    subject: text("subject").notNull(),
    /** Seller-authored, rendered through the transactional email's own markup. */
    bodyMarkdown: text("body_markdown").notNull(),

    /** draft | sending | sent. */
    status: text("status").default("draft").notNull(),

    /** Null means every consented contact. */
    audienceTag: text("audience_tag"),

    /**
     * How many rows were queued when the send began.
     *
     * Stored rather than counted at render time so a partial send is visibly
     * partial: "412 of 900" needs both numbers, and the second one stops
     * being derivable the moment a delivery row is cascaded away.
     */
    recipientCount: integer("recipient_count").default(0).notNull(),

    startedAt: timestamp("started_at"),
    sentAt: timestamp("sent_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("broadcasts_shop_idx").on(t.shopId, t.createdAt),
    // The send pass asks the fleet-wide question "what is mid-flight".
    index("broadcasts_status_idx").on(t.status),
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
