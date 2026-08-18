import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Sailo's own marketing mail — what we have sent a seller, and who has told
 * us to stop.
 *
 * Its own file, beside `audience.ts` rather than inside it, because the two
 * describe opposite directions. `audience.ts` is a *shop* mailing its buyers:
 * every constraint there is shop-scoped, and consent is something a buyer
 * gave a merchant. This is *Sailo* mailing its own users about the product
 * they signed up for, so nothing here has a `shopId` — the seller who has not
 * built a shop yet is exactly the person these tables exist to reach.
 *
 * Two tables and no third. There is deliberately no stored "funnel stage"
 * column: which email a seller is due is derived from the shop, product,
 * payment-rail and order rows that already exist (`lib/lifecycle/state.ts`),
 * the same way the setup checklist derives its ticks. A stored stage is a
 * second answer to a question the data already answers, and the two drift the
 * first time a product is deleted or a rail switched off.
 */

/**
 * One row per lifecycle email per user — written *before* the send, and the
 * unique index below is the whole concurrency design.
 *
 * The claim is the INSERT, exactly as in `event_reminders`: two overlapping
 * cron ticks, a retry, a hand-run while debugging, or two regions firing at
 * once produce one row between them, and only the caller that gets a row back
 * from `ON CONFLICT DO NOTHING RETURNING` is allowed to send. Nothing here
 * reads to decide whether to write.
 *
 * A failed send keeps its claim rather than releasing it — the same trade the
 * event reminders make, for the same reason. "Retried" and "sent twice" are
 * indistinguishable when the failure was in the provider's reply rather than
 * in the delivery, and a seller who missed one nudge is a smaller harm than a
 * seller who got it twice and pressed "report spam" on a domain carrying
 * every other seller's order confirmations. `error` is why, so the miss is
 * visible rather than silent.
 *
 * `email` is snapshotted rather than read back through `userId` because the
 * address that was mailed is a fact, and the account's current address is a
 * different fact. `providerId` is Resend's id, which is what lets the bounce
 * webhook find its way back to this row.
 */
export const lifecycleEmails = pgTable(
  "lifecycle_emails",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /** Which rung of the ladder — see `LIFECYCLE_STEPS` in `lib/lifecycle/steps.ts`. */
    step: text("step").notNull(),
    email: text("email").notNull(),

    providerId: text("provider_id"),
    error: text("error"),

    /** Null until Resend accepts it. A claim is not a delivery. */
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * One send per user per step, decided by Postgres and not by the loop
     * that builds the pass. This is the only thing standing between a replay
     * and a seller being told twice that their shop is live.
     */
    uniqueIndex("lifecycle_emails_user_step_key").on(t.userId, t.step),
    /*
     * The pacing read: "when did this user last hear from us". Ordered by
     * `createdAt` and not `sentAt`, because a claim that failed to send still
     * spent its slot — it is never retried, so treating it as free would let
     * a run of failures stack four emails into one afternoon the moment the
     * provider recovered.
     */
    index("lifecycle_emails_user_created_idx").on(t.userId, t.createdAt),
    /** The platform's daily ceiling counts across every user at once. */
    index("lifecycle_emails_sent_idx").on(t.sentAt),
    /** How a bounce gets from Resend's payload back to an address of ours. */
    index("lifecycle_emails_provider_idx").on(t.providerId),
  ],
);

/**
 * Addresses Sailo may never send marketing to again.
 *
 * Keyed on the address and not the user, for the same reason
 * `email_suppressions` is: a one-click unsubscribe arrives from a mail client
 * with no session and no user id, a bounce arrives from Resend naming only an
 * address, and both must outlive the account. Somebody who unsubscribes,
 * deletes their account and signs up again a year later has still told us no.
 *
 * `reason` is not decoration. A row written by `unsubscribed` may be lifted
 * again from Settings — that is a person changing their mind about their own
 * inbox. A `bounced` or `complained` row may not: those are facts about
 * deliverability, and letting a seller switch marketing back on for an
 * address that reported us as spam trades every other seller's mail for one
 * seller's preference. `lib/lifecycle/opt-out.ts` is where that rule lives.
 */
export const marketingOptOuts = pgTable(
  "marketing_opt_outs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Always lower-cased on the way in — see `optOut`. */
    email: text("email").notNull(),
    /** unsubscribed | bounced | complained — `SUPPRESSION_REASONS`. */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * Unsubscribing twice is not an error, and the second click comes from
     * somebody already annoyed enough to be clicking it twice.
     */
    uniqueIndex("marketing_opt_outs_email_key").on(t.email),
  ],
);

/* --------------------------------------------------------------------------
   Sailo's own mailing list

   Everything above this line is about people who already have an account.
   These three tables are about the people who do not — the ones who read a
   blog post, liked it, and gave us an address before they were ready to sign
   up for anything. That audience did not exist until the blog did, and it is
   the one this company has to be able to write to: a reader who subscribes in
   March is a seller in June, and the pipeline between the two is these rows.

   Deliberately *not* `clients` with a null `shopId`. That table is a shop's
   customer, every constraint on it is shop-scoped, and widening it so Sailo
   could be a shop of its own is how a platform ends up mailing a seller's
   buyers by accident.
-------------------------------------------------------------------------- */

/**
 * One person who asked to hear from Sailo, and what they had been reading
 * when they asked.
 *
 * **Double opt-in, held in `confirmedAt`.** A row exists only once a link
 * sent to that address has been clicked — nothing is written when the form is
 * submitted — so the column is `notNull`. There is no such thing as a
 * pending subscriber here, because a pending subscriber is a row somebody
 * else could have created about you.
 *
 * **Leaving is `marketing_opt_outs`, not a column.** Same reasoning as
 * `email_suppressions` on the shop side: a one-click unsubscribe arrives from
 * a mail client with no session, a bounce arrives from Resend naming only an
 * address, and both must outlive this row. It also means one opt-out covers
 * every kind of marketing Sailo sends — a seller who tells us to stop is not
 * told to say it twice because the newsletter kept its own list.
 *
 * `source` and `sourcePath` are the two columns that make this a marketing
 * asset rather than an address book. Which article converts is the only
 * question the blog can be steered by, and it is unanswerable after the fact:
 * nothing else in the system records where somebody was standing when they
 * subscribed.
 */
export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Always folded on the way in — see `confirmNewsletterSubscriber`. */
    email: text("email").notNull(),
    /** What they typed in the optional name box, so a greeting can use it. */
    name: text("name"),

    /**
     * The language of the page they subscribed from.
     *
     * Stored because it is the only evidence of which language to write to
     * them in, and it is gone the moment the request ends. A Portuguese
     * reader who joined from a Portuguese article and then receives English
     * campaigns forever is the failure this column exists to prevent.
     */
    locale: text("locale").default("en").notNull(),

    /** blog | article | home | pricing | docs | footer — `NEWSLETTER_SOURCES`. */
    source: text("source").default("blog").notNull(),
    /**
     * The exact page, when there was one: `/en/blog/pricing-your-work`.
     *
     * A path and not a URL, because the origin is ours and repeating it 40,000
     * times buys nothing. Null for a signup with no article behind it.
     */
    sourcePath: text("source_path"),

    /** Proof somebody clicked the link in their own inbox. Never null. */
    confirmedAt: timestamp("confirmed_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * One row per address. A second confirmation — the link clicked twice, or
     * a reader who subscribes again a year later — updates this row rather
     * than splitting one person's history in two and mailing them twice.
     */
    uniqueIndex("newsletter_subscribers_email_key").on(t.email),
    /** The list screen, and the growth chart under it. */
    index("newsletter_subscribers_confirmed_idx").on(t.confirmedAt),
    /** "Which article is actually converting" — the only question worth a chart. */
    index("newsletter_subscribers_source_idx").on(t.source, t.confirmedAt),
  ],
);

/**
 * One campaign Sailo wrote to its own list.
 *
 * The shop-side twin is `broadcasts`, and the two are deliberately separate
 * tables rather than one with a nullable `shopId`. Every constraint on a
 * broadcast is a promise made by a *seller* to their buyers — their daily
 * quota, their suppression list, their sending reputation — and a null in
 * that column would make each of those checks something a query could forget.
 * The audiences do not overlap by a single address, and neither do the rules.
 *
 * Statuses match the broadcast pipeline exactly — draft, scheduled, queuing,
 * sending, sent — because the queue below is the same design, and two send
 * pipelines using different words for the same state is how a dashboard ends
 * up reporting one of them wrongly.
 */
export const newsletters = pgTable(
  "newsletters",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    subject: text("subject").notNull(),
    /** The line an inbox shows under the subject. Blank falls back. */
    previewText: text("preview_text"),
    bodyMarkdown: text("body_markdown").notNull(),

    /** draft | scheduled | queuing | sending | sent. */
    status: text("status").default("draft").notNull(),

    /**
     * Who it goes to — `NEWSLETTER_AUDIENCES`.
     *
     * A named audience rather than a rule builder. The shop-side segment
     * builder exists because a seller's list is their customers and only they
     * know which slice they mean; ours is one list with three honest cuts —
     * everybody, the readers who never signed up, the sellers who did — and a
     * rule engine over three options is a feature nobody would finish.
     */
    audience: text("audience").default("all").notNull(),

    /** The button's words, and where it goes. Both optional. */
    ctaLabel: text("cta_label"),
    ctaUrl: text("cta_url"),

    /**
     * How many rows were queued when the send began.
     *
     * Stored rather than counted, so a partial send is visibly partial:
     * "412 of 900" needs both numbers, and the second stops being derivable
     * the moment a delivery row is cascaded away.
     */
    recipientCount: integer("recipient_count").default(0).notNull(),

    /** When a scheduled send becomes due. The cron promotes it. */
    scheduledAt: timestamp("scheduled_at"),
    startedAt: timestamp("started_at"),
    sentAt: timestamp("sent_at"),

    /**
     * The staff address that wrote it.
     *
     * Text and not a foreign key to `user`: staff are identified by an
     * allowlisted address rather than by a row, and a campaign's authorship
     * is a fact about a send that already happened — it must not be
     * cascaded away by an account being deleted years later.
     */
    createdBy: text("created_by"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("newsletters_status_idx").on(t.status),
    /** What is due, across the fleet — the scheduler's own question. */
    index("newsletters_due_idx").on(t.status, t.scheduledAt),
    index("newsletters_created_idx").on(t.createdAt),
  ],
);

/**
 * One row per address, written before anything is sent.
 *
 * The audit trail, and more importantly the resume point: a crash between
 * batches leaves `queued` rows and the next tick picks those up, rather than
 * starting the campaign again from a list it would rebuild identically.
 *
 * `email` is snapshotted rather than read back through `subscriberId`,
 * because the address that was mailed is a fact and the subscriber's current
 * address is a different fact. `providerId` is what lets a bounce webhook
 * find its way back to this row.
 */
export const newsletterDeliveries = pgTable(
  "newsletter_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    newsletterId: uuid("newsletter_id")
      .notNull()
      .references(() => newsletters.id, { onDelete: "cascade" }),
    subscriberId: uuid("subscriber_id").references(
      () => newsletterSubscribers.id,
      { onDelete: "set null" },
    ),

    email: text("email").notNull(),
    /** queued | sending | sent | failed | suppressed. */
    status: text("status").default("queued").notNull(),
    providerId: text("provider_id"),
    error: text("error"),
    attempts: integer("attempts").default(0).notNull(),

    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * One address is mailed once per campaign, decided by Postgres rather
     * than by the loop that builds the queue. A retried enqueue and a second
     * press of Send both collide here.
     */
    uniqueIndex("newsletter_deliveries_target_key").on(t.newsletterId, t.email),
    index("newsletter_deliveries_queue_idx").on(t.newsletterId, t.status),
    /** How a bounce gets from Resend's payload back to an address of ours. */
    index("newsletter_deliveries_provider_idx").on(t.providerId),
    index("newsletter_deliveries_sent_idx").on(t.sentAt),
  ],
);
