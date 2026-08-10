import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  creatorReferrals,
  referralEarnings,
  shops,
  user,
  type Shop,
} from "@/db/schema";
import { maybeRow } from "@/lib/invariant";
import {
  ledgerCurrency,
  newReferralCode,
  normalizeReferralCode,
  referralBalance,
  referralShareCents,
  type ReferralBalance,
} from "./program";

/**
 * The refer-a-creator programme, where it touches the database.
 *
 * Three seams, and each one has a rule it must not break:
 *
 *   - **Attribution** happens once, at shop creation, from a cookie that is
 *     then thrown away. Nothing later in the account's life re-reads it.
 *   - **Earnings** are appended by the platform webhook and nowhere else.
 *     There is no path from a browser to this ledger.
 *   - **Payout** stamps rows. It never edits an amount.
 */

/* -------------------------------------------------------------------------- */
/*  The link                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Issues a code the first time the seller needs one, and keeps it after.
 *
 * Lazy rather than minted at signup: most sellers will never open the card,
 * and generating a unique string for every shop that ever existed is a
 * backfill plus a collision surface bought on their behalf.
 *
 * Null rather than a throw when it cannot mint one. This runs inside the
 * dashboard's own render, and a growth card is never worth five hundreding a
 * seller's home page — the caller simply does not draw the card.
 *
 * Two things can go wrong, and they need different answers:
 *
 *   - **The shop already got one**, from a concurrent render or a refresh.
 *     The `is null` in the WHERE means the second writer takes no rows rather
 *     than overwriting a code the seller may already have posted somewhere.
 *   - **The code collided** with another shop's. That surfaces as a unique
 *     violation from the index, not as zero rows, so it has to be caught —
 *     an uncaught one would escape the loop the loop exists to survive.
 */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const shape = error as { code?: string; cause?: { code?: string } };
  return (
    shape?.code === UNIQUE_VIOLATION || shape?.cause?.code === UNIQUE_VIOLATION
  );
}

export async function ensureReferralCode(shop: Shop): Promise<string | null> {
  if (shop.referralCode) return shop.referralCode;

  const db = getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const claimed = maybeRow(
        await db
          .update(shops)
          .set({ referralCode: newReferralCode() })
          .where(and(eq(shops.id, shop.id), isNull(shops.referralCode)))
          .returning({ code: shops.referralCode }),
      );
      if (claimed?.code) return claimed.code;
    } catch (error) {
      // A collision. Any other failure is not ours to swallow.
      if (!isUniqueViolation(error)) throw error;
      continue;
    }

    // No rows and no error: something else minted for this shop while we were
    // deciding. Read what it settled on rather than guessing.
    const fresh = await db.query.shops.findFirst({
      where: eq(shops.id, shop.id),
      columns: { referralCode: true },
    });
    if (fresh?.referralCode) return fresh.referralCode;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*  Attribution                                                                */
/* -------------------------------------------------------------------------- */

export type AttributionOutcome =
  | "attributed"
  | "no_code"
  | "unknown_code"
  | "self"
  | "already_referred";

/**
 * Records who brought this shop, exactly once, at the moment it is created.
 *
 * Called from `createShop` with whatever `/r/<code>` left in the cookie. It
 * returns an outcome rather than throwing, because none of the refusals are
 * errors — a signup with no cookie, a stale code, or somebody trying to refer
 * themselves are all ordinary and none of them should stop a shop existing.
 *
 * The two abuse cases, and where each is actually stopped:
 *
 *   - **Self-referral.** Checked here on the owner's email, and refused by
 *     the `creator_referrals_not_self` constraint underneath. One person with
 *     two email addresses defeats the email check; the row they create is a
 *     genuine second account, and catching that is fraud review's job, not a
 *     column's. What is closed here is the trivial version.
 *   - **Second touch.** Not checked at all — `creator_referrals_referred_key`
 *     refuses it, and `onConflictDoNothing` turns the refusal into "the first
 *     referrer keeps it". A read-then-write here would have a gap that two
 *     concurrent signups fit through.
 */
export async function attributeReferral(params: {
  referredShopId: string;
  referredEmail: string;
  rawCode: string | null | undefined;
}): Promise<AttributionOutcome> {
  const code = params.rawCode ? normalizeReferralCode(params.rawCode) : null;
  if (!code) return "no_code";

  const db = getDb();

  const referrer = await db
    .select({
      shopId: shops.id,
      email: user.email,
      deletedAt: shops.deletedAt,
      suspendedAt: shops.suspendedAt,
    })
    .from(shops)
    .innerJoin(user, eq(user.id, shops.userId))
    .where(eq(shops.referralCode, code))
    .limit(1);

  const row = maybeRow(referrer);
  if (!row) return "unknown_code";

  /*
   * A tombstoned or suspended shop does not earn. Reported as an unknown
   * code rather than a state of its own, because the difference is not the
   * new seller's business and the outcome is only ever logged.
   */
  if (row.deletedAt || row.suspendedAt) return "unknown_code";

  if (row.shopId === params.referredShopId) return "self";
  if (row.email.toLowerCase() === params.referredEmail.toLowerCase()) {
    return "self";
  }

  const inserted = await db
    .insert(creatorReferrals)
    .values({
      referrerShopId: row.shopId,
      referredShopId: params.referredShopId,
      code,
    })
    .onConflictDoNothing({ target: creatorReferrals.referredShopId })
    .returning({ id: creatorReferrals.id });

  return inserted.length > 0 ? "attributed" : "already_referred";
}

/* -------------------------------------------------------------------------- */
/*  Earnings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Appends the referrer's cut of one paid platform invoice.
 *
 * Called only from the platform webhook. Idempotent by constraint: Stripe
 * delivers at least once, and the `(stripe_invoice_id, kind)` unique index
 * plus `ON CONFLICT DO NOTHING` makes the second delivery add nothing. A
 * read-then-write would let two concurrent deliveries both pass.
 *
 * Returns true only when a row was actually written, so the caller can log
 * the difference between "earned" and "already had it".
 */
export async function recordReferralEarning(params: {
  referredShopId: string;
  stripeInvoiceId: string;
  invoiceAmountCents: number;
  currency: string;
}): Promise<boolean> {
  // A trial, a fully-discounted invoice or a $0 proration earns nothing.
  const amountCents = referralShareCents(params.invoiceAmountCents);
  if (amountCents <= 0) return false;

  const db = getDb();
  const referral = await db.query.creatorReferrals.findFirst({
    where: eq(creatorReferrals.referredShopId, params.referredShopId),
    columns: { id: true, convertedAt: true },
  });
  if (!referral) return false;

  const inserted = await db
    .insert(referralEarnings)
    .values({
      referralId: referral.id,
      stripeInvoiceId: params.stripeInvoiceId,
      kind: "earning",
      amountCents,
      currency: params.currency.toUpperCase(),
    })
    .onConflictDoNothing({
      target: [referralEarnings.stripeInvoiceId, referralEarnings.kind],
    })
    .returning({ id: referralEarnings.id });

  if (inserted.length === 0) return false;

  /*
   * "Converted" is the first invoice, not the latest one. Guarded by the
   * `is null` so a replay or a second month cannot move the date — the
   * referrer's card reads "converted on…" and that has to stay the day it
   * happened.
   */
  if (!referral.convertedAt) {
    await db
      .update(creatorReferrals)
      .set({ convertedAt: new Date() })
      .where(
        and(eq(creatorReferrals.id, referral.id), isNull(creatorReferrals.convertedAt)),
      );
  }

  return true;
}

/**
 * Appends the negative row for a refunded platform invoice.
 *
 * A reversal rather than a deletion or an edit: the earning row is evidence
 * that we owed the money at the time, and a ledger that erases its own
 * history cannot be audited. Its own `kind` so it can share the invoice id
 * with the earning it undoes.
 *
 * Sized on what was actually refunded, so a partial refund reverses a partial
 * commission, and clamped to the earning it undoes — a refund larger than the
 * invoice we commissioned would otherwise claw back money that was never paid.
 */
export async function reverseReferralEarning(params: {
  stripeInvoiceId: string;
  refundedCents: number;
}): Promise<boolean> {
  const db = getDb();

  const earning = await db.query.referralEarnings.findFirst({
    where: and(
      eq(referralEarnings.stripeInvoiceId, params.stripeInvoiceId),
      eq(referralEarnings.kind, "earning"),
    ),
  });
  if (!earning) return false;

  const share = Math.min(referralShareCents(params.refundedCents), earning.amountCents);
  if (share <= 0) return false;

  /*
   * `refundedCents` is the *cumulative* total on the charge, not this refund's
   * increment, so the reversal has to converge on the true total rather than
   * append one row per event. The old code inserted a fresh `reversal` and
   * dropped it on conflict — which meant a first $20 refund reversed its
   * commission, and a later refund of the remaining $80 hit the unique
   * `(invoice, kind)` index and was silently discarded, leaving the referrer
   * paid on money we gave back in full.
   *
   * So the one reversal row per invoice is updated to match the cumulative
   * refund. Replay-safety does not depend on this: every webhook event is
   * fenced by `claimEvent` at the route before it reaches here, so the same
   * event never runs twice. `LEAST` (both amounts are negative, so the more
   * negative is the larger clawback) makes an out-of-order event carrying a
   * smaller cumulative total a no-op rather than a reduction.
   */
  const [row] = await db
    .insert(referralEarnings)
    .values({
      referralId: earning.referralId,
      stripeInvoiceId: params.stripeInvoiceId,
      kind: "reversal",
      amountCents: -share,
      currency: earning.currency,
    })
    .onConflictDoUpdate({
      target: [referralEarnings.stripeInvoiceId, referralEarnings.kind],
      set: { amountCents: -share },
      // Only when this refund claws back *more* than the row already holds.
      // Amounts are negative, so a larger clawback is the smaller number; a
      // replay carrying the same cumulative total leaves it unchanged (and,
      // via `.returning()` yielding no row on a skipped update, reports
      // `false`), while an out-of-order event with a smaller total is ignored.
      setWhere: sql`${referralEarnings.amountCents} > ${-share}`,
    })
    .returning({ amountCents: referralEarnings.amountCents });

  // A returned row means an insert or a real increase in the clawback.
  return Boolean(row);
}

/* -------------------------------------------------------------------------- */
/*  What the seller sees                                                       */
/* -------------------------------------------------------------------------- */

export type ReferralSummary = ReferralBalance & {
  /** Signups that came through this seller's link. */
  referredCount: number;
  /** Of those, the ones now paying Sailo. */
  convertedCount: number;
  /** The ledger's currency, or null while it is empty. */
  currency: string | null;
};

export async function getReferralSummary(shopId: string): Promise<ReferralSummary> {
  const db = getDb();

  const [counts, ledger] = await Promise.all([
    db
      .select({
        referred: sql<string>`count(*)`,
        converted: sql<string>`count(*) filter (where ${creatorReferrals.convertedAt} is not null)`,
      })
      .from(creatorReferrals)
      .where(eq(creatorReferrals.referrerShopId, shopId)),

    db
      .select({
        amountCents: referralEarnings.amountCents,
        currency: referralEarnings.currency,
        paidOutAt: referralEarnings.paidOutAt,
      })
      .from(referralEarnings)
      .innerJoin(
        creatorReferrals,
        eq(creatorReferrals.id, referralEarnings.referralId),
      )
      .where(eq(creatorReferrals.referrerShopId, shopId))
      .orderBy(desc(referralEarnings.createdAt)),
  ]);

  const row = maybeRow(counts);
  return {
    ...referralBalance(ledger),
    referredCount: Number(row?.referred ?? 0),
    convertedCount: Number(row?.converted ?? 0),
    currency: ledgerCurrency(ledger),
  };
}
