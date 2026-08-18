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
import { orders } from "./orders";

/**
 * Chargebacks, and the evidence sent to answer them.
 *
 * Before this table the only record of a dispute was `orders.paymentStatus =
 * 'disputed'` and a sentence in `orders.refundReason`. That is enough to stop
 * showing the sale as complete and enough for nothing else: no amount, no
 * deadline, no network reason code, no record of what was submitted or when, and
 * — the one that matters most — no way to count disputes against the orders they
 * came from, which is the only measurement that detects a bad seller.
 *
 * A dispute is also the one object in Sailo that exists on *both* Stripe
 * accounts. A buyer disputing a seller's sale is a connected-account dispute; a
 * seller disputing their own $49 Sailo subscription is a platform one. They are
 * different money, different liability and different remedies, so `scope`
 * records which, and every query that means one says so.
 */
export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /**
     * Which Stripe account the dispute lives on, and therefore whose money it is.
     *
     * `connected` — a buyer charged back a seller's sale. The seller's balance
     * is debited; Sailo is exposed only if that balance cannot cover it.
     * `platform` — a seller charged back their own Sailo subscription. Sailo's
     * own balance is debited, and the remedy is a plan downgrade rather than
     * evidence about a parcel.
     *
     * Text rather than a boolean because a third scope is foreseeable and
     * because `scope = 'platform'` reads correctly in a query where
     * `isPlatform = true` reads as a question about the shop.
     */
    scope: text("scope").notNull(),

    /**
     * The shop this is about, which a platform dispute has too.
     *
     * Nullable only for the case that genuinely has no shop: a platform charge
     * we cannot trace back to a customer. Everything else — including a
     * subscription chargeback, where the shop is the one that stops being Pro —
     * carries it, because otherwise the dispute cannot be counted against
     * anybody and the rate it belongs in is the whole point of the table.
     */
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "cascade" }),

    /**
     * The order, when there is one.
     *
     * Null for a subscription dispute and null for a charge that arrives before
     * its order has been written. `set null` rather than cascade: a dispute is a
     * fact a bank reported and it outlives the row it was about — deleting the
     * order must not erase the chargeback from the shop's rate.
     */
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),

    /* Stripe's own identifiers. */
    stripeDisputeId: text("stripe_dispute_id").notNull(),
    stripeChargeId: text("stripe_charge_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    /** Null on a platform dispute, which is how the two are told apart in SQL. */
    stripeAccountId: text("stripe_account_id"),

    /* The money. */
    amountCents: integer("amount_cents").default(0).notNull(),
    currency: text("currency").default("USD").notNull(),
    /**
     * Stripe's dispute fee — $15 in USD, and the reason a $42 chargeback costs
     * $57.
     *
     * Read from the dispute's balance transaction rather than assumed, because
     * it varies by the account's country and is not charged at all on an
     * inquiry. Verified in test mode: `fee_details[0].description = "Dispute
     * fee"`, `amount: 1500`.
     */
    feeCents: integer("fee_cents").default(0).notNull(),
    /**
     * What actually left the balance: the amount plus the fee, as one number.
     *
     * Stored rather than computed on read because it is the figure a seller
     * disputes and an accountant reconciles, and because `net` is what Stripe
     * reports — deriving it would mean re-deriving Stripe's arithmetic and
     * eventually disagreeing with it. Zero while the dispute is an inquiry.
     */
    deductedCents: integer("deducted_cents").default(0).notNull(),
    /** Set when the money went out, so the ledger has a date and not a flag. */
    fundsWithdrawnAt: timestamp("funds_withdrawn_at"),
    /** Set when a win put it back. */
    fundsReinstatedAt: timestamp("funds_reinstated_at"),

    /* What the bank said. */
    reason: text("reason").notNull(),
    /** `10.4`, `13.1`, `4855` — the code the network actually decided on. */
    networkReasonCode: text("network_reason_code"),
    network: text("network"),
    /** `inquiry` | `chargeback` | `compliance` — see `lifecycle.ts`. */
    caseType: text("case_type"),
    status: text("status").notNull(),

    /* The clock. */
    dueBy: timestamp("due_by"),
    /**
     * Stripe's own `created`, and the event ordering this table trusts.
     *
     * Webhooks arrive at least once and out of order, so an `updated` carrying
     * `needs_response` can land after the `closed` carrying `won`. Every write
     * compares against this rather than against `updatedAt`, which is our clock
     * and says only when we last wrote.
     */
    stripeCreatedAt: timestamp("stripe_created_at").notNull(),
    stripeUpdatedAt: timestamp("stripe_updated_at"),

    /* The response. */
    evidenceSubmittedAt: timestamp("evidence_submitted_at"),
    submissionCount: integer("submission_count").default(0).notNull(),
    /**
     * Exactly what was sent, as sent.
     *
     * A snapshot and not a reference, because the order it was assembled from
     * keeps changing: the seller edits a product, marks something shipped,
     * issues a refund. Three months later, when the case is lost and somebody
     * asks what we actually claimed, re-assembling from the order answers a
     * different question. This is the only record of the submission, and Stripe
     * will not give it back in full.
     */
    evidenceSnapshot: jsonb("evidence_snapshot"),
    /** Completeness over required fields at submission, in basis points. */
    completenessBp: integer("completeness_bp"),
    /**
     * Stripe's `enhanced_eligibility_types` and the status behind each.
     *
     * `visa_compelling_evidence_3` here is the difference between a fraud case
     * that can be won by rule and one that cannot be won at all. Stored so a
     * seller can be told which, and so the platform can measure how often the
     * data captured at checkout was enough — see `ce3.ts`.
     */
    enhancedEligibility: jsonb("enhanced_eligibility"),
    /** Whether a CE3.0 submission was built, and if not, why not. */
    ce3Status: text("ce3_status"),
    ce3Note: text("ce3_note"),

    /*
     * What the seller has been told, and when.
     *
     * Three columns rather than one flag because they are three different
     * messages with three different deadlines, and a seller who got the "it
     * arrived" mail still needs the reminder four days out.
     *
     * They exist to make sending *idempotent*, which a rate-limit key cannot be.
     * Stripe delivers at least once and out of order, and the same dispute
     * legitimately arrives under several event ids — so the send is claimed with
     * a conditional update (`set … where … is null`) and only the caller that
     * wins the claim sends. Without it a retried `charge.dispute.created` mails
     * the seller twice about one chargeback, which is the shape of bug that
     * makes people turn notifications off.
     */
    sellerOpenedNotifiedAt: timestamp("seller_opened_notified_at"),
    sellerDeadlineNotifiedAt: timestamp("seller_deadline_notified_at"),
    sellerClosedNotifiedAt: timestamp("seller_closed_notified_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * One row per Stripe dispute, decided by Postgres.
     *
     * `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn` and
     * `.funds_reinstated` all describe the same dispute, and the event-id claim
     * in `stripeEvents` does not help: five different events legitimately carry
     * five different ids. Without this, one chargeback becomes five rows and the
     * shop's rate is five times its real value — which would suspend a shop for
     * arithmetic.
     */
    uniqueIndex("disputes_stripe_id_key").on(t.stripeDisputeId),
    index("disputes_shop_idx").on(t.shopId),
    index("disputes_order_idx").on(t.orderId),
    /*
     * The queue: every dispute still owing a response, soonest deadline first.
     * Loaded on every /hq visit and every seller's payments page.
     */
    index("disputes_status_due_idx").on(t.status, t.dueBy),
    /*
     * The rate query. It starts from a shop and joins to orders by their
     * *creation* date, so the shop is the leading column and the scope filter
     * comes next — a connected-account rate must never include a seller's own
     * subscription chargeback.
     */
    index("disputes_shop_scope_idx").on(t.shopId, t.scope),
    index("disputes_charge_idx").on(t.stripeChargeId),
    /*
     * The reminder sweep: open disputes with a deadline nobody has been nagged
     * about yet. Runs every hour against every dispute ever recorded, so it wants
     * the deadline leading — the un-nagged set is tiny and the date is what
     * narrows it.
     */
    index("disputes_deadline_reminder_idx").on(t.dueBy, t.sellerDeadlineNotifiedAt),
  ],
);

/**
 * Stripe Radar's early fraud warnings.
 *
 * A TC40 or SAFE report: the issuer has told the network the cardholder called
 * this transaction fraud, and a chargeback usually follows within days. It is
 * the only advance notice anybody gets, and it is the cheapest possible
 * intervention — refunding on an EFW avoids the chargeback and the $15 fee
 * entirely.
 *
 * Worth being precise about what it does not fix: the fraud report itself still
 * counts towards Visa's VAMP fraud component whether or not the charge is
 * refunded. So refunding is not a way to keep a rate clean, it is a way to stop
 * losing the goods as well as the money. A shop generating EFWs is a shop with a
 * problem, and this table is where that becomes visible before the disputes
 * arrive.
 */
export const earlyFraudWarnings = pgTable(
  "early_fraud_warnings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),

    stripeWarningId: text("stripe_warning_id").notNull(),
    stripeChargeId: text("stripe_charge_id"),
    stripeAccountId: text("stripe_account_id"),

    /** `made_with_stolen_card`, `misc`, `unauthorized_use_of_card`. */
    fraudType: text("fraud_type").notNull(),
    /** Stripe's own flag for whether a dispute has since arrived. */
    actionable: text("actionable"),

    /** Set when the charge was refunded in response, which is the point. */
    refundedAt: timestamp("refunded_at"),
    /** Set when a dispute arrived anyway. */
    disputeId: uuid("dispute_id").references(() => disputes.id, {
      onDelete: "set null",
    }),

    /**
     * When the seller was told, claimed the same way a dispute's mail is.
     *
     * This is the most time-critical message Sailo sends: an early fraud warning
     * is the only advance notice of a chargeback anybody gets, and refunding
     * inside that window avoids the chargeback *and* its fee. A day's delay
     * usually costs both.
     */
    sellerNotifiedAt: timestamp("seller_notified_at"),

    stripeCreatedAt: timestamp("stripe_created_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("efw_stripe_id_key").on(t.stripeWarningId),
    index("efw_shop_idx").on(t.shopId),
    index("efw_charge_idx").on(t.stripeChargeId),
  ],
);

/**
 * One row per time a buyer took a file.
 *
 * `orders.downloadCount` is a counter, and a counter is not a log. Stripe's
 * `access_activity_log` is the whole of the evidence on a digital sale — an
 * issuer reading "downloaded 3 times" learns nothing they can weigh, while three
 * timestamped lines with the buyer's own IP address beside them are exactly what
 * a physical seller gets from a carrier's proof of delivery.
 *
 * So this exists to be evidence, and its shape is Stripe's rather than ours: the
 * three things the log has to state are when, from where, and what.
 *
 * Deliberately not `analytics`. Those tables are aggregated, sampled and pruned
 * on a retention clock; this one is a record kept to answer a bank, and a
 * dispute can arrive 120 days after the sale.
 */
export const downloadEvents = pgTable(
  "download_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Which file, by name — the id would mean nothing to an issuer. */
    fileName: text("file_name"),
    fileId: uuid("file_id"),
    /**
     * The address the file was fetched from.
     *
     * The same value the purchase recorded, and the match between the two is the
     * evidence: a download from the buyer's own purchase address is very hard to
     * argue with. Not identity and never used as a gate — see `client-ip.ts`.
     */
    ip: text("ip"),
    userAgent: text("user_agent"),
    at: timestamp("at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * The evidence query: one order's fetches, oldest first. Composite because
     * it is always both — an unordered list of an order's downloads would have
     * to be sorted in memory on every dispute.
     */
    index("download_events_order_at_idx").on(t.orderId, t.at),
  ],
);

/**
 * A document uploaded to answer a dispute, and where it sits on Stripe.
 *
 * Stripe's evidence object holds a `file_…` id per field and nothing else — no
 * filename, no size, no record of who attached it or when. That is enough to
 * submit and not enough to run a desk: a staff member looking at a case an hour
 * before the deadline needs to see that the proof of delivery is a 1.2 MB PDF
 * the seller uploaded on Tuesday, and a seller needs to see the same thing to
 * know they have already done it.
 *
 * It is also the only way to enforce the ceiling that actually bites. The card
 * networks cap evidence at 4.5 MB *combined across the dispute*, so the question
 * "may this file be added?" cannot be answered from the file — only from the set,
 * which means the set has to be a table. See `@sailo/core/disputes/files`.
 *
 * The rows are a mirror, not the truth: what gets submitted is whatever
 * `respondToDispute` reads from here at the moment of sending. Stripe files are
 * permanent and cannot be deleted through the API, so removing a row detaches
 * the document from the submission and leaves the upload where it is — which is
 * the correct shape for evidence anyway, since a file that was once attached to
 * a case is a thing that happened.
 */
export const disputeEvidenceFiles = pgTable(
  "dispute_evidence_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    disputeId: uuid("dispute_id")
      .notNull()
      .references(() => disputes.id, { onDelete: "cascade" }),

    /**
     * Which Stripe evidence field this fills — `shipping_documentation` and the
     * eight others in `EVIDENCE_FILE_FIELDS`.
     *
     * Unique per dispute, and by Postgres rather than by the application,
     * because Stripe's evidence object has exactly one slot per field: a second
     * row for the same field would submit one of them and silently drop the
     * other, with nothing anywhere recording which.
     */
    field: text("field").notNull(),

    /**
     * The `file_…` id, on the account the dispute belongs to.
     *
     * Account-scoped, and that is the trap: a file uploaded to the platform is
     * not visible to a connected account's `disputes.update`, which fails with an
     * error naming the evidence field rather than the file. The upload therefore
     * carries the same `stripeAccount` as the dispute — see `payments/disputes/files.ts`.
     */
    stripeFileId: text("stripe_file_id").notNull(),

    /* What it is, for the people looking at it rather than for Stripe. */
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),

    /**
     * Who attached it: a staff email, or the shop owner's user id.
     *
     * Free text because the two are different kinds of actor and the audit line
     * needs to say which — "uploaded by the seller" and "uploaded by staff" are
     * different facts about a case that was lost.
     */
    uploadedBy: text("uploaded_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("dispute_evidence_files_field_key").on(t.disputeId, t.field),
    index("dispute_evidence_files_dispute_idx").on(t.disputeId),
  ],
);
