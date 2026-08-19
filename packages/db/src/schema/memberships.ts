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
    /** day | week | month | year, as sold. */
    interval: text("interval").default("month").notNull(),
    /**
     * How many of them per charge — the `3` in "every 3 months".
     *
     * Snapshotted beside the interval for the same reason `priceCents` is: the
     * seller may re-price or re-cycle the product tomorrow and this member is
     * not on the new terms. Without it, a member on a quarterly plan renews
     * monthly the moment the manual cycle reads the row, because "month" alone
     * cannot say "three of them".
     */
    intervalCount: integer("interval_count").default(1).notNull(),

    /**
     * Sailo's cut of this subscription's invoices, in basis points -- our
     * mirror of Stripe's `application_fee_percent`.
     *
     * Stored because it is the only way to notice the fee has gone stale
     * without asking Stripe about every member on every sweep. It was set once
     * at checkout from whatever plan the seller was on that day and then never
     * touched again, so a seller who upgraded to Business went on paying 3% on
     * every membership they had already sold while the pricing table promised
     * them 1%, and one who downgraded kept the 1% for ever. Neither shows up
     * anywhere a person looks: the fee is deducted inside Stripe's payout.
     *
     * Basis points rather than Stripe's percentage, matching `Plan.feeBp` and
     * `platformFeeBp`, so the comparison that drives the sweep is between two
     * integers. Converted at the Stripe boundary and nowhere else.
     *
     * Null means we have never observed it -- every row written before this
     * column existed, which is exactly the backlog the first sweep corrects.
     */
    applicationFeeBp: integer("application_fee_bp"),

    /**
     * The period a renewal order has already been raised for.
     *
     * The claim that stops a cron tick raising a second one. Compared against
     * `currentPeriodEnd` in the WHERE of a conditional UPDATE, so two
     * overlapping ticks produce one order between them rather than one each —
     * and a member is never asked twice for the same month.
     */
    renewalOrderedFor: timestamp("renewal_ordered_for"),

    /* ---- Fixed term — spec 49 ------------------------------------------- */

    /**
     * How many cycles this member has actually paid for.
     *
     * Incremented in the **same conditional UPDATE that records the period**,
     * beside `renewalOrderedFor` and `orders.membershipPeriodEnd`. Those two
     * columns exist precisely because a seller toggling an order paid →
     * unpaid → paid must buy one month rather than three, and counting cycles
     * has the identical hazard: a count incremented in its own statement is a
     * count a webhook retry doubles.
     */
    cyclesPaid: integer("cycles_paid").default(0).notNull(),
    /**
     * The term this member signed up to, snapshotted.
     *
     * Null is open-ended, which is every membership sold before this column.
     * Snapshotted rather than read from the product for the same reason
     * `priceCents` is: a seller who shortens the course next year has not
     * shortened one somebody already bought.
     */
    termCycles: integer("term_cycles"),
    /**
     * Whether the door stays open once the last cycle is paid.
     *
     * This is what makes a fixed term a *payment plan* — a course sold in
     * three instalments, expressed in a model that already works, with none of
     * the partial-delivery problem: access is granted from the first payment
     * either way, so a failed third cycle costs the seller a payment rather
     * than leaving an entitlement half-earned.
     *
     * The one new branch in `membershipAccess` reads this and nothing else.
     */
    accessAfterTerm: boolean("access_after_term").default(false).notNull(),
    /** term_complete | canceled | expired | disputed. */
    endedReason: text("ended_reason"),

    /* ---- Pause — spec 49 ------------------------------------------------- */

    /**
     * When the freeze started, and when it lifts.
     *
     * **Access is closed while paused**, and it is closed by the one new
     * branch rather than a second predicate: a pause that kept access would be
     * a free month, and the whole point is that the member is not using it.
     * The door pass closes with it for nothing — `checkInMemberByCode` already
     * re-asks `membershipAccess` on every scan.
     *
     * On the card rail this mirrors Stripe's `pause_collection` and Stripe
     * pushes the billing clock; on the manual rail the renewal cron skips and
     * `currentPeriodEnd` moves by the paused days on resume. We do not
     * recompute Stripe's arithmetic in either case.
     */
    pausedAt: timestamp("paused_at"),
    pausedUntil: timestamp("paused_until"),
    /**
     * Days spent frozen, ever. What stops a rolling permanent pause against
     * `products.pauseMaxDays` — a member frozen for good is a free membership.
     */
    pauseDaysUsed: integer("pause_days_used").default(0).notNull(),

    /* ---- Seats — spec 49 ------------------------------------------------- */

    /**
     * How many people this subscription is for.
     *
     * `quantity` on the Stripe subscription, so the price is Stripe's
     * arithmetic and never ours. One is every membership that exists today.
     */
    seats: integer("seats").default(1).notNull(),
    /**
     * Reserved for a seat that is its own subscription row rather than a
     * `subscription_seats` entry — a company that wants each employee billed
     * separately. Nothing writes it yet; the column exists so the foreign key
     * and the index land in one migration rather than two.
     */
    parentSubscriptionId: uuid("parent_subscription_id"),

    /* ---- Dunning — spec 49 ----------------------------------------------- */

    /**
     * How many times we have told this member their payment failed, and when.
     *
     * The *claim*, not a log. Each send is taken by conditional UPDATE — the
     * `sellerOpenedNotifiedAt` pattern on `disputes` — because Stripe delivers
     * `invoice.payment_failed` at least once and out of order, and a member
     * receiving the same "your card failed" three times is a member who rings
     * their bank.
     *
     * Reset to zero by a successful payment, so a card that recovers and fails
     * again next quarter starts the sequence over rather than expiring
     * immediately.
     */
    dunningAttempts: integer("dunning_attempts").default(0).notNull(),
    dunningLastSentAt: timestamp("dunning_last_sent_at"),

    /* ---- Switching — spec 49 --------------------------------------------- */

    /**
     * A switch the member has asked for, taking effect at the period end.
     *
     * At the period end **by default**, and that is the whole of the decision
     * the memberships notes left open: no proration, no surprise invoice, no
     * number Sailo computed. An immediate switch is offered only where
     * Stripe's own proration produces the amount.
     */
    pendingProductId: uuid("pending_product_id"),
    pendingEffectiveAt: timestamp("pending_effective_at"),

    /**
     * What the member shows at the door.
     *
     * Null until somebody needs one — `ensureMemberPass` mints on first use
     * rather than at signup, because the majority of memberships sold here are
     * a file or a Discord invite and will never be scanned, and a credential
     * issued to somebody who never uses it is a credential to lose.
     *
     * Unlike a ticket this never burns. A ticket is one admission and moves
     * `valid → used`; a member turns up ninety times a year, so the code is
     * durable and every scan re-asks `membershipAccess` whether the
     * subscription is still open. That is the whole difference between the two
     * credentials, and it is why this is a column here rather than a row in
     * `tickets`.
     */
    passCode: text("pass_code"),

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
    /*
     * Global rather than per-shop, and plain for the same reason as above.
     *
     * The door resolves a scanned code *before* it knows whose membership it
     * is — that is what scanning means — so a code that means one thing in one
     * shop and another somewhere else is a code that admits the wrong person
     * the day a seller opens a second gym.
     */
    uniqueIndex("subscriptions_pass_code_key").on(t.passCode),
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
    /* The switch sweep's own question: which switches are due. */
    index("subscriptions_pending_switch_idx").on(t.pendingEffectiveAt),
    /* And the resume sweep's: which paused memberships are due back. */
    index("subscriptions_paused_idx").on(t.pausedUntil),
  ],
);

/**
 * One person on somebody else's subscription — spec 49.
 *
 * The shape that turns a membership into something a *company* buys. The payer
 * holds the billing relationship and each seat holds its own access, which is
 * the division that keeps `membershipAccess` from forking: a seat's
 * entitlement is read from the **parent's** status and period end, and the row
 * here only says who.
 *
 * Reached by a signed token like everything else a buyer touches. This is the
 * closest buyer identity has come to needing an account and it still does not
 * need one.
 */
export const subscriptionSeats = pgTable(
  "subscription_seats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    /** Folded to lowercase by the writer, so the unique index actually bites. */
    email: text("email").notNull(),
    name: text("name"),
    /**
     * This seat's own credential.
     *
     * A shared code for eight employees is one code at the door, and
     * attendance stops meaning anything the first time two of them arrive
     * together. Twelve characters, the same length and alphabet as
     * `subscriptions.passCode`, because the door resolves whichever it is
     * handed.
     */
    passCode: text("pass_code"),
    invitedAt: timestamp("invited_at").defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("subscription_seats_subscription_email_key").on(
      t.subscriptionId,
      t.email,
    ),
    /*
     * Global, exactly as `subscriptions_pass_code_key` is and for the identical
     * reason: the door resolves a scanned code *before* it knows whose
     * membership it is, so a code meaning one thing in one shop and something
     * else in another admits the wrong person the day a seller opens a second
     * gym.
     */
    uniqueIndex("subscription_seats_pass_code_key").on(t.passCode),
    index("subscription_seats_subscription_idx").on(t.subscriptionId, t.invitedAt),
  ],
);

/**
 * One member, admitted once. Append-only.
 *
 * Deliberately not a counter on `subscriptions`. A counter answers "how many
 * times" and nothing else, and every question a gym actually asks needs a row:
 * who came this week, has this member stopped turning up, was that scan mine
 * or the evening volunteer's. It is also what makes a disputed cancellation
 * arguable — a member who says they never used the place has a row per visit
 * saying otherwise.
 *
 * Not `tickets`, either. A ticket is one admission and burns itself on use;
 * this is the log of a credential that never burns. Sharing the table would
 * mean `status` meaning two different things depending on which kind of row
 * you were looking at.
 */
export const memberCheckins = pgTable(
  "member_checkins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    /**
     * Cascade, unlike an order. Attendance documents no money and carries no
     * retention duty, and a visit whose subscription is gone is a row nobody
     * can interpret.
     */
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    /**
     * Which membership admitted them, snapshotted at scan time. `set null`
     * rather than cascade: deleting the product has not un-happened anybody's
     * visit, and the history is what this table is for.
     */
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    /** The door pass that scanned, as `tickets.checkedInBy`. Null is the owner. */
    checkedInBy: text("checked_in_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * Leads with the subscription because the hottest read is the double-scan
     * guard — "was this member already admitted in the last few minutes" —
     * which runs on every scan, before anybody is let in.
     */
    index("member_checkins_subscription_idx").on(t.subscriptionId, t.createdAt),
    index("member_checkins_shop_idx").on(t.shopId, t.createdAt),
  ],
);
