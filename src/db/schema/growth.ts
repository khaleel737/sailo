import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { shops } from "./shop";

/**
 * Creators bringing other creators to Sailo, and what we owe them for it.
 *
 * Deliberately not in `commerce.ts` beside `affiliates`. That table is a
 * seller paying someone to sell *their products*; this is Sailo paying a
 * seller for bringing us *another seller*. The two are one word apart in
 * English and nothing alike in the money they move — the affiliate ledger
 * lives on a shop's own orders, and this one lives on our subscription
 * invoices. Keeping them in separate files is the cheapest way to stop the
 * next person reaching for the wrong one.
 */

/**
 * One creator brought in by another. First touch, and permanent.
 *
 * `referredShopId` is unique, which is the whole attribution policy expressed
 * as a constraint rather than as a rule someone has to remember: a shop has
 * at most one referrer, ever, and the second link to reach the same signup
 * loses. Doing it in the index rather than in a read-then-write also means
 * two links arriving at once cannot both win.
 */
export const creatorReferrals = pgTable(
  "creator_referrals",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    referrerShopId: uuid("referrer_shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    referredShopId: uuid("referred_shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /**
     * The code exactly as it was used, kept even though `referrerShopId`
     * already identifies who earned it. A referrer can rotate their code; the
     * question "which link produced this signup" then has no other answer.
     */
    code: text("code").notNull(),

    attributedAt: timestamp("attributed_at").defaultNow().notNull(),
    /** First paid platform invoice. Null while the referred shop is on free. */
    convertedAt: timestamp("converted_at"),
  },
  (t) => [
    uniqueIndex("creator_referrals_referred_key").on(t.referredShopId),
    index("creator_referrals_referrer_idx").on(t.referrerShopId),
    /*
     * Self-referral, refused by the database.
     *
     * The application refuses it too — `attributeReferral` checks the owner's
     * email before it writes — but a referral programme is a thing people
     * attack, and the application check is one code path that a future
     * refactor can route around. This one cannot be routed around, and it
     * costs nothing.
     */
    check(
      "creator_referrals_not_self",
      sql`${t.referrerShopId} <> ${t.referredShopId}`,
    ),
  ],
);

/**
 * The money, append-only.
 *
 * Every row is one Stripe invoice's worth of commission: a positive
 * `earning` when the referred creator pays us, a negative `reversal` when
 * that payment is refunded. Nothing is ever updated in place except
 * `paidOutAt`, which is a stamp rather than an amount — the same shape
 * `orders.commissionPaid` uses, and for the same reason: a balance you can
 * recompute from rows is a balance you can audit, and one you overwrite is a
 * number you have to trust.
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

    createdAt: timestamp("created_at").defaultNow().notNull(),
    /** Stamped when a human in /hq sends the money. */
    paidOutAt: timestamp("paid_out_at"),
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
    // "Who are we still short with" — the only query /hq runs on this table.
    index("referral_earnings_unpaid_idx").on(t.paidOutAt),
  ],
);
