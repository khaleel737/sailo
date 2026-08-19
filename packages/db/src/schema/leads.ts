import { sql } from "drizzle-orm";
import {
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
import { products } from "./catalog";
import { clients } from "./orders";
import type { LeadAnswer } from "./json-types";

/**
 * What somebody left behind in exchange for a free thing.
 *
 * Spec 07. A lead product's checkout is a form rather than a purchase: no
 * order, no invoice number, no stock, no money. That separation is the whole
 * design — a lead is not a £0 sale, and treating it as one would put rows into
 * the invoice sequence a tax authority expects to describe actual trade.
 *
 * The contact itself is an ordinary `clients` row with `source = 'lead'`. This
 * table is the *submission*: which magnet, when, and what they answered.
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /**
     * The contact this submission made, or null once that contact is gone.
     *
     * `set null` rather than cascade, for the same reason a testimonial keeps
     * its author name: the seller's own record of how many people asked for a
     * thing must survive one of them being deleted. `email` below is what the
     * row is identified by, and it is folded, so the record stays *countable*
     * without staying *attributable*.
     */
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),

    /**
     * The address, and the row's real identity.
     *
     * Uniqueness is on (product, email) rather than (product, client) because
     * `client_id` is nullable and Postgres treats two NULLs in a unique index
     * as distinct — so a shop that had deleted two contacts could collect the
     * same lead twice.
     *
     * **Stored folded**, unlike `clients.email` which keeps the casing the
     * buyer typed. The two columns are for different things: a contact's
     * address is shown back to the seller and addressed mail is sent to it, so
     * its casing is theirs to keep; this one exists only to be matched, and
     * folding it at the write is what makes the unique index a plain one rather
     * than an expression index — which is the difference between an upsert the
     * query builder can express and a hand-written statement.
     */
    email: text("email").notNull(),
    name: text("name"),

    /**
     * The seller's questions and this person's answers, with the question text
     * snapshotted beside each one.
     *
     * The label is stored, not just the id. A seller who renames "Which team
     * are you on?" to "Company size" next month must not silently relabel every
     * answer already given — the answer would then be a reply to a question
     * nobody was asked.
     */
    answers: jsonb("answers").$type<LeadAnswer[]>().default([]).notNull(),

    /*
     * The magnet, when the product has files to hand over.
     *
     * A token of this lead's own rather than the order download token spec 07
     * imagined reusing. `/download/[token]` resolves an *order* — it renders
     * tickets, event links, membership state and writes `download_events` for
     * chargeback evidence — and a lead has none of those and must never
     * acquire them. Two small columns here are cheaper than a second meaning
     * for every line of the money path's delivery gate.
     *
     * **Hashed, never stored plain.** The same rule `door_passes` and the
     * broadcast tokens already follow: this string is a bearer credential to
     * somebody's file, and a database read must not hand out live links.
     *
     * Revoking one is deleting the lead, which is what a seller already
     * understands and needs no second screen. The cap and the expiry are the
     * product's own `download_limit` and `download_expiry_days`, so a seller
     * configures a magnet exactly as they configure a paid download.
     */
    magnetTokenHash: text("magnet_token_hash"),
    magnetExpiresAt: timestamp("magnet_expires_at"),
    magnetDownloads: integer("magnet_downloads").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("leads_shop_created_idx").on(t.shopId, t.createdAt),
    index("leads_product_idx").on(t.productId),
    uniqueIndex("leads_product_email_key").on(t.productId, t.email),
    // The magnet link's lookup. Partial, because most leads never have one.
    uniqueIndex("leads_magnet_token_key")
      .on(t.magnetTokenHash)
      .where(sql`${t.magnetTokenHash} is not null`),
  ],
);

export type Lead = typeof leads.$inferSelect;
