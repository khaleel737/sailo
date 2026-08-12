import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shop";
import { products } from "./catalog";
import { clients } from "./orders";

/**
 * A buyer paying a seller every month.
 *
 * Its own file because it is the one place in the schema where *two* systems
 * both hold the truth and neither is wrong: Stripe decides whether money
 * arrived, and this table decides whether the member gets in. They are
 * reconciled by webhook and they are allowed to disagree for a few seconds;
 * what is not allowed is either one being read for the other's question.
 *
 * The division, spelled out because every bug in a subscription system comes
 * from blurring it:
 *
 *   **Stripe is the billing source of truth.** What the member is charged,
 *   when, whether the card worked, what a proration comes to. We never
 *   compute any of it and never store a copy we would have to keep correct.
 *
 *   **This table is the access source of truth.** Whether the door opens
 *   right now. It is a mirror of Stripe's answer, written by the webhook —
 *   but it is the mirror the app reads, because asking Stripe on every
 *   request would put an API call in front of a file download and fail closed
 *   whenever Stripe is slow.
 */

/**
 * One buyer's subscription to one product.
 *
 * Not a row per payment — the payments are `orders`, one per paid invoice, so
 * Income, exports and the invoice sequence keep telling the truth without
 * learning what a subscription is. This is the standing arrangement behind
 * them.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    /**
     * What they subscribed to. `set null` rather than cascade: a seller who
     * deletes the product has not ended anybody's billing, and a subscription
     * row that vanished would leave a member being charged by Stripe with
     * nothing here to cancel or even name.
     */
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),

    /**
     * How this membership gets paid for — `stripe` or `manual`.
     *
     * The one column that decides who runs the renewal cycle. Everything else
     * about a membership is the same either way, which is the point: access,
     * grace, cancellation and the members list all read `status` and
     * `currentPeriodEnd` and never ask how those came to be written.
     */
    billingMode: text("billing_mode").default("stripe").notNull(),

    /**
     * Which rail a manual member pays on — `bank_transfer`, `cod`, `whatsapp`.
     *
     * Carried so a renewal can be raised on the same rail the member chose,
     * with the same instructions they were given the first time. Null for a
     * card subscription, where Stripe is the rail.
     */
    paymentMethod: text("payment_method"),

    /**
     * Stripe's own id for this subscription, on the *seller's* account.
     *
     * Nullable, because a manual membership has none — there is no Stripe
     * object behind a member who pays cash at the door. Still unique where it
     * is present, and that uniqueness is the idempotency that makes
     * at-least-once webhook delivery safe: `customer.subscription.updated`
     * arriving three times upserts one row.
     */
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** The buyer's customer record on the seller's account — the billing portal needs it. */
    stripeCustomerId: text("stripe_customer_id"),
    /**
     * The account this subscription lives on, snapshotted at creation.
     *
     * The same reasoning as `orders.stripeAccountId`: it is what an incoming
     * webhook is checked against, and reading the shop's *current* account
     * instead would detach every existing member the day a seller reconnects
     * Stripe — their renewals would arrive on an account that no longer
     * matched and be dropped, while Stripe kept charging.
     */
    stripeAccountId: text("stripe_account_id"),

    /** trialing | active | past_due | canceled | unpaid | incomplete. */
    status: text("status").default("incomplete").notNull(),

    /**
     * Paid up to here. The grace boundary, and the reason a cancelled member
     * keeps their access until the end of a period they already paid for.
     */
    currentPeriodEnd: timestamp("current_period_end"),
    /** Set when the member asked to stop but the period has not run out yet. */
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    canceledAt: timestamp("canceled_at"),
    trialEndsAt: timestamp("trial_ends_at"),

    /**
     * What it costs, snapshotted.
     *
     * A copy of a Stripe Price rather than a join to the product, because the
     * seller may re-price the product tomorrow and this member is not on that
     * price — they are on the one they signed up at, and the members list has
     * to be able to say so without asking Stripe about each row.
     */
    priceCents: integer("price_cents").default(0).notNull(),
    currency: text("currency").default("USD").notNull(),
    /** month | year, as sold. */
    interval: text("interval").default("month").notNull(),

    /**
     * The period a renewal order has already been raised for.
     *
     * The claim that stops a cron tick raising a second one. Compared against
     * `currentPeriodEnd` in the WHERE of a conditional UPDATE, so two
     * overlapping ticks produce one order between them rather than one each —
     * and a member is never asked twice for the same month.
     */
    renewalOrderedFor: timestamp("renewal_ordered_for"),

    startedAt: timestamp("started_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * One row per Stripe subscription, decided by Postgres rather than by
     * whichever webhook arrived first. Two overlapping deliveries of
     * `customer.subscription.created` collide here instead of creating a
     * member twice — and a member counted twice is a member billed once and
     * shown as two, which is the shape of complaint nobody can reproduce.
     */
    /*
     * Deliberately *not* partial, even though a manual membership leaves this
     * column null. Postgres already allows any number of NULLs under a plain
     * unique index, so `where not null` would buy nothing but intent — and it
     * costs a real trap: a partial index cannot be inferred by `ON CONFLICT`
     * unless every upsert repeats its predicate, and the one that forgets
     * fails with `42P10` on every single write. It was written partial first,
     * and that is exactly what happened.
     */
    uniqueIndex("subscriptions_stripe_key").on(t.stripeSubscriptionId),
    // The members list: this shop, these statuses, newest first.
    index("subscriptions_shop_idx").on(t.shopId, t.status, t.createdAt),
    // "Is this person a member" — asked on every gated download.
    index("subscriptions_client_idx").on(t.clientId, t.status),
    /*
     * The renewal cron's own question, fleet-wide: which manual memberships
     * are coming up for payment. Without it the tick reads every subscription
     * on the platform to find the handful that are due.
     */
    index("subscriptions_due_idx").on(t.billingMode, t.status, t.currentPeriodEnd),
    index("subscriptions_product_idx").on(t.productId),
  ],
);
