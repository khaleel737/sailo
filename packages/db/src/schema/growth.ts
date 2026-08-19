import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { shops } from "./shop";
import { productVariants, products } from "./catalog";

/**
 * The partner programme: people who bring Sailo creators, and what we owe them.
 *
 * Deliberately not in `commerce.ts` beside `affiliates`. That table is a
 * seller paying someone to sell *their products*; this is Sailo paying someone
 * for bringing us *another seller*. The two are one word apart in English and
 * nothing alike in the money they move — the affiliate ledger lives on a
 * shop's own orders, and this one lives on our subscription invoices. Keeping
 * them in separate files is the cheapest way to stop the next person reaching
 * for the wrong one.
 *
 * A partner is its own identity rather than a column on `shops`, because the
 * people who actually drive referral volume — newsletter writers, YouTubers,
 * agencies — are frequently not sellers themselves and never will be. A seller
 * who becomes a partner gets a row here linked back to their user; a stranger
 * with an audience gets one that isn't.
 */

/* -------------------------------------------------------------------------- */
/*  The partner                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One person or company in the programme, at whatever stage they've reached.
 *
 * `status` is the whole lifecycle: `pending` while a human decides,
 * `approved` once they can earn, `rejected` if we said no, `suspended` if we
 * stopped them after saying yes. Only `approved` earns — enforced in
 * `attributeReferral` and again at payout, because a suspended partner whose
 * old links keep paying out is the failure this column exists to prevent.
 */
export const partners = pgTable(
  "partners",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /**
     * The account they sign in with. Required — the portal is behind a real
     * session rather than a bearer token in a URL, because unlike a seller's
     * affiliate portal this one can move money by changing where it goes.
     */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /**
     * Their shop, when they have one. Nullable and *not* the identity: a
     * partner who later opens a shop keeps the same partner row, the same
     * code and the same ledger.
     */
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),

    /** pending | approved | rejected | suspended */
    status: text("status").default("pending").notNull(),

    /** Display name for the partner, as they gave it. */
    name: text("name").notNull(),
    /** Where they'll be promoting us — the thing review actually reads. */
    website: text("website"),
    audience: text("audience"),
    /** Their own words on why they're a fit. */
    pitch: text("pitch"),

    /**
     * The code in their links. Minted at approval, not at application, so a
     * rejected applicant never holds a live code.
     *
     * Public by design — it appears in every link they post — so nothing may
     * be derived from it and nothing may be read with it.
     */
    code: text("code"),

    /**
     * Their rate in basis points, when it differs from the programme default.
     *
     * Null means "whatever the programme says today", which is the case for
     * almost everyone. A number here is a negotiated deal and it *overrides*
     * the default permanently — that is the point, and it is why the rate
     * actually used is copied onto every earning row rather than re-derived.
     */
    commissionBp: integer("commission_bp"),

    /*
     * There are no Stripe columns here, and that is the design.
     *
     * A partner must be an active paying seller, so they already have a
     * connected account — the one their own buyers pay into — and commission
     * is transferred there. Mirroring a *second* account per partner is what
     * this table used to do, and it brought a recipient service agreement, a
     * country picker, a cross-border zone and a hand-payment fallback with it.
     * `lib/partners/eligibility.ts` answers both questions from `shops` now.
     */

    /* ---- Review trail ---------------------------------------------------- */

    appliedAt: timestamp("applied_at").defaultNow().notNull(),
    reviewedAt: timestamp("reviewed_at"),
    /** The staff email, not a user id — it stays readable forever. */
    reviewedBy: text("reviewed_by"),
    /** Shown to the applicant on rejection; internal `notes` are not. */
    reviewNote: text("review_note"),
    /** HQ's private scratchpad on this partner. */
    notes: text("notes"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * One partner per account. The application form is a public, logged-in
     * POST and "apply twice quickly" is the ordinary double-submit, so the
     * refusal belongs here rather than in a read-then-write two requests can
     * both pass.
     */
    uniqueIndex("partners_user_key").on(t.userId),
    /*
     * Unique, and the lookup `/r/<code>` runs on every click of every partner
     * link anyone has ever posted. Postgres treats NULLs as distinct, so
     * every applicant still awaiting a decision coexists under it without a
     * partial-index clause.
     */
    uniqueIndex("partners_code_key").on(t.code),
    index("partners_status_idx").on(t.status),
    index("partners_shop_idx").on(t.shopId),
    /*
     * An approved partner must have a code — approval that left someone with
     * nothing to share would be a dead end they could only discover by asking.
     *
     * Deliberately one-directional. The converse ("only approved partners hold
     * a code") would force suspension to null the column, and a partner who
     * was suspended for a fortnight and then reinstated would come back with a
     * different code than the one already printed in their newsletter. A
     * suspended partner keeps their code and stops earning by `canEarn`, which
     * both `attributeReferral` and `recordReferralEarning` consult.
     */
    check(
      "partners_approved_has_code",
      sql`${t.status} <> 'approved' or ${t.code} is not null`,
    ),
    /*
     * A negotiated rate is still a rate. 0 is meaningful (a partner kept on
     * the books but earning nothing); above 100% would mean paying out more
     * than the invoice brought in, which is never a deal, only a typo.
     */
    check(
      "partners_commission_bp_range",
      sql`${t.commissionBp} is null or (${t.commissionBp} >= 0 and ${t.commissionBp} <= 10000)`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Attribution                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One creator brought in by a partner. First touch, and permanent.
 *
 * `referredShopId` is unique, which is the whole attribution policy expressed
 * as a constraint rather than as a rule someone has to remember: a shop has
 * at most one partner, ever, and the second link to reach the same signup
 * loses. Doing it in the index rather than in a read-then-write also means
 * two links arriving at once cannot both win.
 */
export const creatorReferrals = pgTable(
  "creator_referrals",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    referredShopId: uuid("referred_shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /**
     * The code exactly as it was used, kept even though `partnerId` already
     * identifies who earned it. A partner can rotate their code; the question
     * "which link produced this signup" then has no other answer.
     */
    code: text("code").notNull(),

    attributedAt: timestamp("attributed_at").defaultNow().notNull(),
    /** First paid platform invoice. Null while the referred shop is on free. */
    convertedAt: timestamp("converted_at"),
  },
  (t) => [
    uniqueIndex("creator_referrals_referred_key").on(t.referredShopId),
    index("creator_referrals_partner_idx").on(t.partnerId),
  ],
);

/* -------------------------------------------------------------------------- */
/*  The money                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The ledger, append-only.
 *
 * Every row is one Stripe invoice's worth of commission: a positive
 * `earning` when the referred creator pays us, a negative `reversal` when
 * that payment is refunded. Nothing is ever updated in place except
 * `paidOutAt` and `payoutId`, which are stamps rather than amounts — the same
 * shape `orders.commissionPaid` uses, and for the same reason: a balance you
 * can recompute from rows is a balance you can audit, and one you overwrite is
 * a number you have to trust.
 */
export const referralEarnings = pgTable(
  "referral_earnings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    referralId: uuid("referral_id")
      .notNull()
      .references(() => creatorReferrals.id, { onDelete: "cascade" }),

    /** The platform invoice this came from. */
    stripeInvoiceId: text("stripe_invoice_id").notNull(),
    /** earning | reversal — see the unique index below. */
    kind: text("kind").default("earning").notNull(),

    /** Minor units. Negative on a reversal, so the balance is a plain sum. */
    amountCents: integer("amount_cents").notNull(),
    /** The invoice's currency, not the shop's — this is Sailo paying, not them. */
    currency: text("currency").notNull(),

    /**
     * The rate this row was computed at, copied rather than referenced.
     *
     * The programme default can change and a partner can be moved onto a
     * negotiated rate; neither may retroactively restate what we owed for an
     * invoice paid last March. Recording it also makes the ledger checkable —
     * amount ÷ rate should reproduce the invoice.
     */
    commissionBp: integer("commission_bp").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),

    /**
     * When the money became eligible to send.
     *
     * Later than `createdAt` by the programme's hold period, so a refund that
     * lands in the first fortnight reverses against a balance we still hold
     * rather than against money already gone. Stored rather than computed at
     * read time because the hold period is a setting, and a row must keep the
     * terms it was written under.
     */
    matureAt: timestamp("mature_at").defaultNow().notNull(),

    /** Stamped when the transfer for this row actually settled. */
    paidOutAt: timestamp("paid_out_at"),
    /** The payout that settled it — null until then. */
    payoutId: uuid("payout_id"),
  },
  (t) => [
    /*
     * Idempotency, as a constraint.
     *
     * Stripe delivers at least once, so `invoice.paid` will arrive twice and
     * the second arrival must add nothing. The guard is this index plus an
     * `ON CONFLICT DO NOTHING` insert, not a read-then-write: two deliveries
     * being processed concurrently both pass a read-then-write.
     *
     * Keyed on (invoice, kind) rather than invoice alone because one invoice
     * legitimately produces two rows — the earning, and later its reversal if
     * we refund. Keying on the invoice alone would silently drop the reversal
     * and leave us owing commission on money we gave back.
     */
    uniqueIndex("referral_earnings_invoice_kind_key").on(
      t.stripeInvoiceId,
      t.kind,
    ),
    index("referral_earnings_referral_idx").on(t.referralId),
    // "Who are we still short with, and is it out of hold yet" — the only
    // question the payout run asks of this table.
    index("referral_earnings_unpaid_idx").on(t.paidOutAt, t.matureAt),
    index("referral_earnings_payout_idx").on(t.payoutId),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Payouts                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One attempt to send a partner their balance.
 *
 * Written `pending` *before* Stripe is called and only then stamped, which is
 * what makes a crashed payout run recoverable: a row stuck in `pending` names
 * an attempt whose outcome we do not know, and `reconcilePendingPayouts` asks
 * Stripe rather than guessing. Creating the row afterwards would lose exactly
 * the cases worth keeping.
 *
 * A `failed` row is kept, not deleted. "We tried on the 1st and Stripe said
 * the balance was short" is the answer to a support question that otherwise
 * has none.
 */
export const partnerPayouts = pgTable(
  "partner_payouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),

    /** Minor units, always positive — we never "pay" a negative balance. */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),

    /** pending | paid | failed */
    status: text("status").default("pending").notNull(),

    /** The Stripe transfer, once there is one. */
    stripeTransferId: text("stripe_transfer_id"),
    /**
     * The key we sent Stripe, generated before the call and stored with the
     * attempt. A retry reuses it, so a payout that timed out after Stripe had
     * already accepted it cannot become two transfers.
     */
    idempotencyKey: text("idempotency_key").notNull(),

    /** Stripe's message when it refused, kept verbatim for support. */
    failureReason: text("failure_reason"),

    /** auto | manual — a cron run or a human in /hq. */
    initiatedBy: text("initiated_by").default("auto").notNull(),
    /** The staff email when `initiatedBy` is manual. */
    initiatedByEmail: text("initiated_by_email"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    paidAt: timestamp("paid_at"),
  },
  (t) => [
    uniqueIndex("partner_payouts_idempotency_key").on(t.idempotencyKey),
    index("partner_payouts_partner_idx").on(t.partnerId),
    index("partner_payouts_status_idx").on(t.status),
    uniqueIndex("partner_payouts_transfer_key").on(t.stripeTransferId),
    check("partner_payouts_amount_positive", sql`${t.amountCents} > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Programme settings                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The terms of the programme, as one editable row.
 *
 * A single row, pinned by the `singleton` check — settings that can exist
 * twice are settings that disagree. Everything here is something HQ can change
 * without a deploy, and `lib/partners/settings.ts` is the only reader; the
 * defaults it falls back to when the row is missing are the same numbers, so
 * a fresh database behaves like a configured one.
 *
 * The rate lives here rather than in code because it is a commercial term
 * someone will want to move for a campaign. What does *not* live here is the
 * rate any given earning was paid at — see `referralEarnings.commissionBp`.
 */
export const partnerProgramSettings = pgTable(
  "partner_program_settings",
  {
    id: integer("id").default(1).primaryKey(),

    /** Whether the application form accepts anything at all. */
    acceptingApplications: boolean("accepting_applications")
      .default(true)
      .notNull(),
    /**
     * Approve applicants who already run a paying shop, without review.
     *
     * They are a known, billed customer with a verified email; making them
     * wait days for a link is friction with no fraud story behind it. Cold
     * applicants still queue.
     */
    autoApproveSellers: boolean("auto_approve_sellers").default(true).notNull(),

    /** The default share, in basis points. 3000 = 30%. */
    commissionBp: integer("commission_bp").default(3000).notNull(),

    /** Smallest balance we'll send, in minor units. */
    payoutMinimumCents: integer("payout_minimum_cents").default(2500).notNull(),

    /** How long a click stays attributable. */
    cookieDays: integer("cookie_days").default(90).notNull(),

    /**
     * Days an earning sits before it can be paid.
     *
     * Covers the window in which the referred creator can be refunded: pay on
     * day one and a day-nine refund claws back money that is already in
     * someone else's bank.
     */
    holdDays: integer("hold_days").default(30).notNull(),

    /** Whether the cron actually sends, or only computes what it would send. */
    autoPayout: boolean("auto_payout").default(true).notNull(),
    /** Day of the month the payout run fires, 1–28. */
    payoutDayOfMonth: integer("payout_day_of_month").default(1).notNull(),

    /** The programme terms, shown on the landing page and the portal. */
    terms: text("terms"),

    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    updatedBy: text("updated_by"),
  },
  (t) => [
    check("partner_program_settings_singleton", sql`${t.id} = 1`),
    check(
      "partner_program_settings_commission_bp_range",
      sql`${t.commissionBp} >= 0 and ${t.commissionBp} <= 10000`,
    ),
    check(
      "partner_program_settings_payout_day_range",
      sql`${t.payoutDayOfMonth} >= 1 and ${t.payoutDayOfMonth} <= 28`,
    ),
    check(
      "partner_program_settings_non_negative",
      sql`${t.payoutMinimumCents} >= 0 and ${t.cookieDays} >= 0 and ${t.holdDays} >= 0`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Offers — specs 36 and 08                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A companion product put in front of a buyer, in one of two places.
 *
 * Spec 08 proposed `products.bumpProductId` + `bumpHeadline`, one bump per
 * product, which was its own stated v1 limit. Spec 36 supersedes it: the moment
 * cross-sells exist the two features want the same columns — display type,
 * override price, validity window, position — so building 08 as written and
 * replacing it a week later is wasted work. 08's `orderItems.viaBump` is kept
 * exactly as specified.
 *
 * WHERE, AND WHY THE TWO PLACES ARE NOT THE SAME
 *
 *   `bump`       in-cart, one tap, above the pay button
 *   `crosssell`  after payment, on the thank-you page, never blocking anything
 *
 * Baymard found 66% of shoppers made to pass a cross-sell before completing a
 * transaction reported extreme frustration, which is Easytools' own argument
 * for post-purchase placement and it is right. The buyer's confirmation, files
 * and invoice are visible before any offer is; a funnel that delays a download
 * is a support ticket.
 *
 * FLAT, WITH `parentId` FROM DAY ONE
 *
 * Always null in v1 — `GAP-2026-08-easytools.md` §4.6 refuses three-level
 * down-sell trees. The column is here so nesting is a migration and an editor
 * away rather than a rewrite. Nothing writes it and nothing reads it.
 */
export const offers = pgTable(
  "offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    placement: text("placement").notNull(), // bump | crosssell

    /**
     * What triggers it. **Null means every product in the shop**, which is what
     * a seller with one thing to cross-sell actually wants — and saves them
     * attaching the same offer to forty products by hand.
     */
    sourceProductId: uuid("source_product_id").references(() => products.id, {
      onDelete: "cascade",
    }),
    /**
     * What is offered.
     *
     * Cascade rather than `set null`: an offer whose product is gone is not an
     * offer, and a row that renders nothing is a take-rate denominator nobody
     * can explain.
     */
    offerProductId: uuid("offer_product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    offerVariantId: uuid("offer_variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),

    /** Always null in v1. See the header. */
    parentId: uuid("parent_id"),

    title: text("title"),
    body: text("body"),
    buttonLabel: text("button_label"),
    display: text("display").default("card").notNull(), // card | compact | timer

    /**
     * An override, in the shop's minor units. Null sells at the product's own
     * price.
     *
     * **Read from this column and never from the browser.** A cross-sell adds
     * no pricing trust at all: the whole line goes through `resolveLines` like
     * any other, and the "prices from the shop, never from the browser"
     * scenario pins it.
     */
    priceCents: integer("price_cents"),

    validFrom: timestamp("valid_from"),
    /**
     * Checked **at the charge**, not only at render.
     *
     * Theirs is explicit about this and it is the right rule: a buyer who opens
     * a time-limited offer must not be able to complete it once it has expired,
     * even with the page still open. The same rule spec 43's sell windows
     * follow, for the same reason.
     */
    validUntil: timestamp("valid_until"),

    position: integer("position").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("offers_lookup_idx").on(
      t.shopId,
      t.sourceProductId,
      t.placement,
      t.position,
    ),
    index("offers_shop_idx").on(t.shopId, t.placement, t.position),
  ],
);

/**
 * How a seller learns whether any of this works.
 *
 * Take-rate is `taken / shown`, so `shown` is written when an offer *renders*
 * or the denominator is a guess — which is the difference between a number a
 * seller can act on and one they cannot.
 *
 * The unique index on (offer, order) for `taken` is in `0042` rather than here,
 * because it is partial on `outcome` and drizzle's builder cannot express that.
 * It is the idempotency: one-click means double-click, so the row is claimed
 * *before* anything is charged and released on refusal — the shape the refund
 * race fix used. It covers `taken` only; a unique index over `shown` would
 * silently swallow the second impression, which is the denominator.
 */
export const offerEvents = pgTable(
  "offer_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    /**
     * The order it was shown against.
     *
     * `set null` rather than cascade: a deleted order must not take a seller's
     * take-rate history with it.
     */
    orderId: uuid("order_id"),
    /** The order taking it produced, once there is one. */
    resultingOrderId: uuid("resulting_order_id"),
    outcome: text("outcome").notNull(), // shown | taken | skipped | expired
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("offer_events_offer_idx").on(t.offerId, t.createdAt)],
);
