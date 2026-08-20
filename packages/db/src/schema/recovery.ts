import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { shops } from "./shop";
import { products } from "./catalog";
import { clients, orders } from "./orders";

/**
 * Every checkout a buyer opened, and what became of it.
 *
 * Sailo's only abandonment handling was a 24-hour sweep that cancels unpaid
 * orders and reclaims stock and slots. That protects *inventory*. It does
 * nothing for revenue: nobody was ever asked to come back.
 *
 * **What is refused is as much of the design as what is taken.** Theirs is a
 * staffed service on a 10% commission with a cross-seller buyer network — and
 * the seller here is merchant of record, so there is no settlement to take a
 * commission at, and a shared network would put one seller's buyers inside
 * another's checkout. There is no `commission` column and no query in this
 * feature joins sessions across shops. `0049_checkout_sessions.sql` argues it
 * at length.
 *
 * **The half nobody else can build** is `handoffOrderId`. On the chat rails
 * the order is persisted *before* the buyer is handed off, so a buyer who
 * never sent the WhatsApp message has left a complete order row — basket,
 * contact, everything — sitting unread. It costs almost nothing once the card
 * half exists, because the follow-up machinery is identical, and no competitor
 * can build it because no competitor writes the order first.
 */
export const checkoutSessions = pgTable(
  "checkout_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    /** The order this session became, once it was paid. */
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),

    /**
     * What the buyer typed into *this* checkout.
     *
     * The consent rule turns on it. A recovery mail may go to an address typed
     * here, or to an existing client of this shop, and to nothing else ever —
     * never from a marketing list, never from another shop, and never past a
     * suppression of any kind.
     */
    email: text("email"),
    phone: text("phone"),

    /** See `SESSION_STATUSES`. */
    status: text("status").default("opened").notNull(),

    /**
     * Which browser this is, as an opaque first-party id.
     *
     * Not derived from IP or user agent: a phone changing network mid-checkout
     * would read as two buyers, which is the reasoning the download rate limit
     * already records. Not a cross-shop identifier either — the unique indexes
     * are keyed per shop, and nothing joins across them.
     */
    visitorKey: text("visitor_key").notNull(),

    currency: text("currency"),
    subtotalCents: integer("subtotal_cents"),

    /**
     * Why a payment attempt failed, through an allowlist before it is stored.
     *
     * Never a card detail, never a client secret, never a PAN. This column
     * records *that* an attempt failed and roughly why, and nothing whatsoever
     * about the instrument. A raw provider string rendered into the seller's
     * panel would be untrusted input on a page with a session behind it.
     */
    lastError: text("last_error"),

    /**
     * A real single-use coupon, minted per session and expiring with it.
     *
     * Null when the coin came up tails, which is most of the time and is the
     * point: award one every time and buyers learn to abandon on purpose.
     */
    discountCode: text("discount_code"),

    /**
     * The order this session started *from* — the chat-rail half.
     *
     * Separate from `orderId`, which is the order it became. Different
     * questions: a recovered handoff has both, pointing at the same row.
     */
    handoffOrderId: uuid("handoff_order_id").references(() => orders.id, {
      onDelete: "set null",
    }),

    recoverySentAt: timestamp("recovery_sent_at"),
    recoveredAt: timestamp("recovered_at"),
    /**
     * When the abandonment was announced to the flows engine — spec 30's
     * `checkout.abandoned` trigger. Its own stamp, deliberately not
     * `recovery_sent_at`: the built-in email and a seller's own sequence are
     * separate decisions, and a shop with recovery off still gets its flows.
     * Conditional-UPDATE-claimed, so two ticks cannot announce one session.
     */
    flowEnrolledAt: timestamp("flow_enrolled_at"),

    openedAt: timestamp("opened_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    /** Thirty days, theirs: "we remember their entry for 30 days". */
    expiresAt: timestamp("expires_at"),
  },
  (t) => [
    /*
     * One live session per (shop, browser, product) — their behaviour exactly:
     * a revisit updates rather than inserting. Partial on the open states, so
     * the same buyer coming back next month starts a new one.
     *
     * Two indexes and not one, because `productId` is nullable and Postgres
     * treats NULLs as distinct: without the second, a cart checkout — which
     * names no single product — would get a row per view.
     */
    uniqueIndex("checkout_sessions_visitor_key")
      .on(t.shopId, t.visitorKey, t.productId)
      .where(
        sql`${t.status} in ('opened','error','help_requested') and ${t.productId} is not null`,
      ),
    uniqueIndex("checkout_sessions_visitor_cart_key")
      .on(t.shopId, t.visitorKey)
      .where(
        sql`${t.status} in ('opened','error','help_requested') and ${t.productId} is null`,
      ),
    index("checkout_sessions_shop_idx").on(t.shopId, t.status, t.openedAt),
    /*
     * The conversion funnel counts "this shop, opened between" with no
     * status pin — `status` in the middle of the pair above blocks the range,
     * so that read covered the shop's lifetime sessions on every /admin/
     * analytics view.
     */
    index("checkout_sessions_shop_opened_idx").on(t.shopId, t.openedAt),
    index("checkout_sessions_due_idx")
      .on(t.status, t.openedAt)
      .where(sql`${t.status} in ('opened','error')`),
    index("checkout_sessions_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} is not null`),
    /* The flow-enrolment claim's own scan: overdue, unclaimed, unordered.
       Partial, so it holds only the rows a pass could still announce. */
    index("checkout_sessions_flow_due_idx")
      .on(t.openedAt)
      .where(
        sql`${t.status} in ('opened','error') and ${t.flowEnrolledAt} is null and ${t.orderId} is null`,
      ),
  ],
);
