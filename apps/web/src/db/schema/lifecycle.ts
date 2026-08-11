import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
