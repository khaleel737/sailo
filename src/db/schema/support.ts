import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shop";

/**
 * A seller asking us for help.
 *
 * The ticket is written here first and emailed to support second, so a mail
 * outage degrades to "answered from HQ" rather than "never seen". The seller
 * is CC'd on that mail, which is what lets support reply to them directly —
 * the thread already carries both addresses.
 */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /** The login email the reply goes to, frozen at filing time. */
    email: text("email").notNull(),
    /** technical | billing | payments | orders | account | other */
    topic: text("topic").default("other").notNull(),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    /** Screenshots the seller attached. Kept after close, for the record. */
    imageUrls: jsonb("image_urls").$type<string[]>().default([]).notNull(),

    status: text("status").default("open").notNull(), // open | closed
    createdAt: timestamp("created_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
  },
  (t) => [
    index("support_tickets_shop_idx").on(t.shopId, t.createdAt),
    /** HQ's default view: the open ones, oldest wait first. */
    index("support_tickets_status_idx").on(t.status, t.createdAt),
  ],
);
