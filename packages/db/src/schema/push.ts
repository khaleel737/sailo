import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Where to reach a seller's phone.
 *
 * One row per device that has agreed to be notified, holding the Expo push
 * token that device was issued. This is the only thing in the schema whose
 * value is an address at a third party rather than a fact about the business,
 * which is why it sits apart from `shop.notificationPrefs`: the prefs say
 * *whether* to tell the seller, this says *where*, and the two change for
 * completely different reasons.
 *
 * Keyed on the user rather than the shop even though every notification sent
 * through it is about a shop. A phone belongs to a person — the same person
 * signs in to the app, and `shops.userId` already maps their shop back to
 * them. Keying on the shop would mean rewriting every row the day a user is
 * allowed a second shop, and would leave the token stranded in the meantime.
 */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /**
     * Expo's own token — `ExponentPushToken[…]` — not APNs' or FCM's.
     *
     * It is a routing address and not a credential: holding one lets somebody
     * send *to* that device through Expo, it grants nothing here, and it reads
     * nothing. Stored in plaintext for the same reason the webhook secret is —
     * there is no hashed form we could still send to.
     */
    token: text("token").notNull(),

    /** `ios` | `android`. What the token was minted for, for support and stats. */
    platform: text("platform").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    /**
     * Last time this device announced itself, which the app does on every
     * launch it has permission for. Not decoration: Expo only tells us a token
     * is dead when we send to it, and a seller who deletes the app is never
     * sent to again, so without this there is no way to tell a live device from
     * one that stopped existing eighteen months ago.
     */
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    /**
     * Unique on the token *alone*, deliberately not on `(userId, token)`.
     *
     * A phone is a place, not a possession of one account. When a seller signs
     * out and their colleague signs in on the same handset, the device reports
     * the same token under a new user — and the composite key would happily
     * store both rows, so the next order would push to a phone the previous
     * seller no longer holds. That is somebody else's order data on somebody
     * else's lock screen, which is the same tenant boundary the router defends
     * and it would be crossed here instead.
     *
     * With uniqueness on the token, that second registration collides and the
     * upsert moves ownership: one device, one row, whoever is signed in now.
     */
    uniqueIndex("push_tokens_token_key").on(t.token),
    // The read on the send path: every device belonging to one seller.
    index("push_tokens_user_id_idx").on(t.userId),
  ],
);
