import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { shops } from "./shop";
import { orders } from "./orders";

/**
 * The things a chargeback is answered with that Sailo was not writing down.
 *
 * Spec 44. Everything here exists to be read months after the sale, by somebody
 * arguing with a bank, and every one of these tables shares a property that
 * makes it unlike the rest of the schema: **it cannot be backfilled.** A dispute
 * arrives up to 120 days after a sale and Visa's CE3.0 wants two matching
 * transactions between 120 and 365 days old, so the value of a row written today
 * is realised next spring. `ce3.ts` already makes this argument about
 * `orders.buyerIp`:
 *
 *   *"It is retroactive in the worst way. The two prior transactions must
 *   already carry the data points, so a platform that starts capturing IP
 *   addresses today cannot use CE3.0 for another four months."*
 *
 * Which is why these ship before the features that read them.
 *
 * ## Retention
 *
 * 400 days, and deliberately **outside the analytics retention sweep**.
 * `download_events` already states the distinction and it applies again: these
 * are aggregated by nobody and sampled by nobody, they are a record kept to
 * answer a bank, and a dispute can arrive four months after the sale with a
 * compliance case behind it.
 *
 * ## What none of them are
 *
 * None of these is a gate. `account_events` records an address; it never decides
 * anything, for the reason `client-ip.ts` gives — an IP is a header the client
 * can set, which is fine as an observation to an issuer and worthless as access
 * control.
 */

/**
 * Every message sent to a buyer about one order, as it was sent.
 *
 * Stripe's `customer_communication` slot asks for "the messages", and
 * `FILE_ASKS.customer_communication` asks the *seller* to upload them — while
 * Sailo sends most of them and logged none. `orders.confirmationSentAt` is a
 * single timestamp; `broadcast_deliveries` is marketing, not transactional.
 *
 * Two rules govern every row here and they are both about honesty to an issuer:
 *
 * **Written only where the send actually succeeded.** A logged message that was
 * never sent is worse than no log at all — it is a false claim to a bank, made
 * on the seller's behalf, and it is exactly the kind of overstatement that loses
 * a case and damages the person who submitted it.
 *
 * **`bodyText` as sent, never a template id.** The template changes; what the
 * buyer read does not. This is the same reasoning `disputes.evidenceSnapshot`
 * already gives for snapshotting rather than referencing.
 */
export const orderMessages = pgTable(
  "order_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /**
     * `confirmation` | `invoice` | `shipped` | `refund` | `download` |
     * `reminder` | `renewal` | `seller_note`.
     */
    kind: text("kind").notNull(),

    /**
     * `outbound` | `inbound`.
     *
     * Inbound exists because Sailo's ordering model is chat-first: most buyer
     * communication happens on WhatsApp, where Sailo cannot see it. A box for
     * the seller to paste an exchange into is the difference between an empty
     * evidence slot and a filled one, and it costs a text column.
     */
    direction: text("direction").default("outbound").notNull(),

    toAddress: text("to_address"),
    subject: text("subject"),
    /** The rendered text part, as sent. */
    bodyText: text("body_text"),

    providerMessageId: text("provider_message_id"),

    /**
     * `sent` | `delivered` | `bounced` | `complained`, updated by the existing
     * signature-verified Resend webhook.
     *
     * A **bounced** confirmation is itself evidence: it explains why a buyer says
     * they never heard anything, and disclosing it is honest in a way that
     * hiding it is not.
     */
    status: text("status"),

    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (t) => [
    index("order_messages_order_idx").on(t.orderId, t.sentAt),
    index("order_messages_shop_idx").on(t.shopId, t.sentAt),
    /*
     * The bounce webhook arrives with a provider id and nothing else, so this is
     * the only way back to the row. Partial: most rows never get one, and an
     * index over mostly-NULL is mostly waste.
     */
    index("order_messages_provider_idx")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
  ],
);

/**
 * Things that happened to an account, kept longer than a session is.
 *
 * better-auth's `session` already carries `ipAddress`, `userAgent`, `city`,
 * `country` and `createdAt` — exactly what a subscription chargeback wants. But
 * sessions expire and are removed, so a dispute arriving 120 days after a
 * seller's last sign-in finds nothing. Spec 46 cannot be built on a table that
 * empties itself.
 *
 * `userId` is deliberately a bare `text` with no foreign key. Account deletion
 * (spec 03) retains the ledger and these rows are part of it: a chargeback from
 * somebody who has since closed their account is precisely the case that still
 * needs answering, and a cascade would delete the answer.
 */
export const accountEvents = pgTable(
  "account_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),

    /**
     * `signin` | `signup` | `plan_change` | `subscription_paid` |
     * `terms_accepted`.
     *
     * `terms_accepted` is the seller accepting *Sailo's* terms at signup, which
     * is what spec 46 leads with and which nothing recorded durably.
     */
    kind: text("kind").notNull(),

    ip: text("ip"),
    userAgent: text("user_agent"),
    city: text("city"),
    country: text("country"),
    detail: jsonb("detail"),

    at: timestamp("at").defaultNow().notNull(),
  },
  (t) => [
    index("account_events_user_idx").on(t.userId, t.at),
    index("account_events_shop_kind_idx").on(t.shopId, t.kind, t.at),
  ],
);
