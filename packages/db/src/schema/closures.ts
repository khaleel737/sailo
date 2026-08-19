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

/**
 * What a shop was, written down before it stopped being it.
 *
 * ─── THE HOLE THIS FILLS ─────────────────────────────────────────────────────
 * `deleteAccountFor` in `@sailo/account/deletion` does exactly what it says:
 * anonymise the ledger, delete the rest. The `shops` row survives as the
 * retention container for orders and invoices, and everything that made it
 * identifiable is overwritten — name becomes "Deleted shop", the handle becomes
 * `deleted-<hex>`, the owner's name and email become tombstones at
 * `@sailo.invalid`, and products, reviews, coupons, affiliates, payment methods
 * and support tickets are hard-deleted outright.
 *
 * That is the correct behaviour for the seller who is leaving, and it is a
 * blindfold for the one who is not. Take deposits for a fortnight, never ship,
 * delete the account: the orders survive, and there is no longer anything on
 * them that says who ran the shop, what it claimed to sell, or how many buyers
 * were left holding an invoice. Support gets forty emails naming a storefront
 * that no longer exists, and the honest answer to "what happened here" is that
 * we deleted the evidence ourselves, on request, at the moment it became
 * interesting.
 *
 * So one row is written *before* the tombstone, and it is the only thing about
 * a closed shop that is written to survive it.
 *
 * ─── WHY THIS IS NOT A GDPR PROBLEM, AND WHERE THE LINE IS ───────────────────
 * A deletion request is not absolute: Article 17(3)(b) and (e) leave data in
 * place for legal obligations and for legal claims, and fraud prevention is
 * named as a legitimate interest in Recital 47. But "we kept everything, for
 * fraud" is the answer of a company that did not want to decide, so this table
 * decides, and the decision is in `identityRetained`:
 *
 *   - **Every** closure keeps the non-identifying shape of the business: what
 *     it sold, how much, how many buyers, how many chargebacks, when it opened
 *     and when it stopped. None of that is personal data about the seller and
 *     all of it is what a pattern is made of.
 *
 *   - **Every** closure keeps `ownerEmailHash` — a salted digest, never the
 *     address. It answers exactly one question: is the person signing up today
 *     the person who closed that shop? A hash cannot be read, mailed, sold or
 *     leaked into a support reply, and it cannot answer any other question.
 *
 *   - Only a closure that happened **under suspicion** keeps the readable
 *     identity: the shop was suspended, its payouts were held, it had open
 *     chargebacks, or a staff member closed it. There the retention is a
 *     specific legitimate interest in a specific dispute, which is the shape
 *     Article 17(3)(e) actually contemplates, rather than a policy of keeping
 *     everyone's name in case.
 *
 * `identityRetained` records which of those two happened, so the question "why
 * do we still have this person's name" has an answer on the row itself.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─── WHY IT IS NOT A CHEAPER THING ───────────────────────────────────────────
 * It could have been a `staffActions` row, and that was the first idea. It is
 * not, because `staffActions.summary` is one sentence of prose written for a
 * human reading a timeline — it cannot be filtered by chargeback count, joined
 * to a new signup, or counted. And a closure is not a staff action at all in
 * the common case: the seller did it themselves, from their own settings page,
 * and no staff member was involved to be the actor.
 *
 * One row per closed shop. Shops close rarely; this table stays smaller than
 * any index on `orders`.
 */
export const shopClosures = pgTable(
  "shop_closures",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /**
     * The shop that closed, which still exists — that is the whole point of the
     * tombstone. `cascade` because if a `shops` row ever genuinely goes, the
     * ledger it was holding has gone with it and this record is describing
     * nothing.
     */
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /**
     * Better-auth's user id, kept as plain text and not a reference.
     *
     * No FK on purpose: the `user` row survives deletion today, but it survives
     * as a tombstone, and nothing in this record should depend on a row whose
     * whole purpose is to be emptied. The id is what joins this to `staffActions`
     * and to `session` history if either is ever asked.
     */
    userId: text("user_id").notNull(),

    closedAt: timestamp("closed_at").defaultNow().notNull(),

    /**
     * `seller` — they asked, from their own settings page.
     * `staff` — we closed it for them.
     *
     * Text rather than a boolean, because a third is foreseeable: an automated
     * closure on an unpaid balance, or a closure carried out to satisfy a
     * regulator's order, are both different facts from either of these.
     */
    closedBy: text("closed_by").$type<"seller" | "staff">().notNull(),
    /** The staff address, when `closedBy` is `staff`. Null when the seller did it. */
    closedByEmail: text("closed_by_email"),
    /** Free text: what they typed, or what we recorded. */
    reason: text("reason"),

    /**
     * Whether the readable identity below is populated — see the header.
     *
     * `false` is the ordinary case and means `ownerName`, `ownerEmail`,
     * `contactEmail` and `shopName` are null: an unremarkable seller left and
     * we kept the shape of their business and a hash of their address, nothing
     * more. `true` means the closure met one of the suspicion tests in
     * `@sailo/account/deletion`, and the identity is retained under a named
     * legitimate interest rather than by default.
     */
    identityRetained: text("identity_retained")
      .$type<"none" | "suspicion">()
      .default("none")
      .notNull(),

    /* ── The identity, retained only under suspicion ────────────────────── */
    ownerName: text("owner_name"),
    ownerEmail: text("owner_email"),
    shopName: text("shop_name"),
    contactEmail: text("contact_email"),
    location: text("location"),

    /**
     * A salted digest of the lowercased owner address, on every closure.
     *
     * This is the one field that makes the table worth having at signup rather
     * than only in hindsight: it recognises the address without storing it. The
     * salt is a deployment secret, so the digests are useless outside our own
     * database — a leaked copy of this table cannot be rainbow-tabled back into
     * a mailing list.
     *
     * Nullable because a shop whose owner row had already been tombstoned by an
     * earlier partial run has no address left to hash, and a closure record
     * with everything else in it is worth more than none.
     */
    ownerEmailHash: text("owner_email_hash"),

    /**
     * The handle the storefront traded under, before it was released.
     *
     * Kept because it is what every link, screenshot and support email in the
     * world still says. A buyer writing in three weeks later says "I bought
     * from sailo.store/ada-ceramics", and without this column there is nothing
     * on the platform that has ever heard of it.
     */
    handle: text("handle").notNull(),

    /* ── The shape of the business, retained always ─────────────────────── */
    currency: text("currency").notNull(),
    orderCount: integer("order_count").default(0).notNull(),
    paidOrderCount: integer("paid_order_count").default(0).notNull(),
    /** Gross minus refunds, in `currency`, over the shop's whole life. */
    grossCents: integer("gross_cents").default(0).notNull(),
    refundedCents: integer("refunded_cents").default(0).notNull(),
    /** Orders paid and never delivered at the moment of closure. The buyer's loss. */
    undeliveredPaidOrders: integer("undelivered_paid_orders").default(0).notNull(),
    disputeCount: integer("dispute_count").default(0).notNull(),
    openDisputeCents: integer("open_dispute_cents").default(0).notNull(),
    productCount: integer("product_count").default(0).notNull(),
    buyerCount: integer("buyer_count").default(0).notNull(),
    firstOrderAt: timestamp("first_order_at"),
    lastOrderAt: timestamp("last_order_at"),
    shopCreatedAt: timestamp("shop_created_at").notNull(),

    /* ── What we already thought of them ────────────────────────────────── */
    suspendedAt: timestamp("suspended_at"),
    suspendedReason: text("suspended_reason"),
    payoutsPausedAt: timestamp("payouts_paused_at"),
    /** The internal note, which is often the only sentence explaining any of this. */
    staffNote: text("staff_note"),

    /* ── Stripe, so the trail continues where our rows stop ─────────────── */
    stripeAccountId: text("stripe_account_id"),
    stripeCustomerId: text("stripe_customer_id"),

    /**
     * What the shop said it sold, capped.
     *
     * `[{ title, kind, priceCents }]` for up to fifty products, taken before
     * the catalogue is deleted. Fifty rather than all of them because this is
     * evidence about the *character* of the shop — "forty listings all named
     * after a designer handbag" is the whole finding, and rows fifty-one
     * onwards do not change it. jsonb rather than a child table for the same
     * reason: nothing will ever query inside this, it is read whole by a human
     * looking at one closure.
     */
    catalogue: jsonb("catalogue")
      .$type<{ title: string; kind: string; priceCents: number }[]>()
      .default([])
      .notNull(),
  },
  (t) => [
    /** The list's default order: most recent closures first. */
    index("shop_closures_closed_at_idx").on(t.closedAt),
    /**
     * The signup-time question — "have we seen this person before?" — which is
     * a lookup by digest and has to be cheap enough to run on a path nobody is
     * waiting on. Partial, because a row without a hash can never match.
     */
    index("shop_closures_email_hash_idx").on(t.ownerEmailHash),
    /**
     * One closure per shop, and unique because that is what makes a retried
     * deletion an upsert rather than a second row. `recordClosure` conflicts on
     * this index; without the constraint the ON CONFLICT has nothing to target
     * and a crash mid-deletion leaves two partial records of the same shop.
     */
    uniqueIndex("shop_closures_shop_key").on(t.shopId),
  ],
);
