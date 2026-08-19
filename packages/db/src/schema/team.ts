import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shop";

/**
 * Who did what in a shop that has more than one person in it — spec 37.
 *
 * The one table the organization plugin does not provide, and the one this
 * spec still writes. It answers *"who refunded that?"*, which is the first
 * question asked the first time a team member does something surprising — and
 * a question `orders` cannot answer, because an order records what happened to
 * it and not which of three people made it happen.
 *
 * Append-only, like every ledger here. Nothing updates a row and nothing
 * deletes one; a member being removed does not remove what they did.
 *
 * `actor_email` rather than a user id, and that is deliberate. The record has
 * to survive the account: a person removed from the team, or one who deleted
 * their Sailo account entirely, still did the thing, and a foreign key would
 * either cascade the history away or block the deletion. The address is what
 * the seller will recognise a year later.
 */
export const shopMemberActions = pgTable(
  "shop_member_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /** Who. Lower-cased, and never a foreign key — see the header. */
    actorEmail: text("actor_email").notNull(),
    /** Their role at the time, which may not be their role now. */
    actorRole: text("actor_role"),

    /** What: `order.refund`, `product.delete`, `team.invite`. */
    action: text("action").notNull(),
    /** What it was done to: `order`, `product`, `member`. */
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),

    /**
     * Whatever the action wants remembered — an amount, an old value.
     *
     * Deliberately shapeless. A column per fact would be a migration per
     * action, and this is a log: nothing queries inside it, and everything that
     * reads it is a human looking at one row.
     */
    detail: jsonb("detail"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // "This shop, most recent first" is the only question anything asks.
    index("shop_member_actions_shop_created_idx").on(t.shopId, t.createdAt),
  ],
);

export type ShopMemberAction = typeof shopMemberActions.$inferSelect;
