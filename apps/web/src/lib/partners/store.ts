import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  creatorReferrals,
  partners,
  referralEarnings,
  shops,
  user,
} from "@/db/schema";
import { maybeRow } from "@/lib/invariant";
import { getProgramSettings } from "./settings";
import {
  canEarn,
  commissionCents,
  ledgerCurrency,
  maturityDate,
  normalizeReferralCode,
  partnerBalance,
  resolveCommissionBp,
  type PartnerBalance,
} from "./program";

/**
 * The partner programme, where it touches the database.
 *
 * Three seams, and each one has a rule it must not break:
 *
 *   - **Attribution** happens once, at shop creation, from a cookie that is
 *     then thrown away. Nothing later in the account's life re-reads it.
 *   - **Earnings** are appended by the platform webhook and nowhere else.
 *     There is no path from a browser to this ledger.
 *   - **Payout** stamps rows. It never edits an amount. (In `./payouts.ts`.)
 */

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
 *   - **Self-referral.** Checked here three ways: the partner's own user, the
 *     partner's own shop, and the applicant's email address. One person with
 *     two email addresses defeats all three; the account they create is a
 *     genuine second signup, and catching that is fraud review's job in /hq,
 *     not a column's. What is closed here is the trivial version.
 *   - **Second touch.** Not checked at all — `creator_referrals_referred_key`
 *     refuses it, and `onConflictDoNothing` turns the refusal into "the first
 *     partner keeps it". A read-then-write here would have a gap that two
 *     concurrent signups fit through.
 *
 * A code belonging to a partner who is not approved reports `unknown_code`
 * rather than a state of its own. The difference is not the new seller's
 * business, the outcome is only ever logged, and saying "that partner is
 * suspended" to an unauthenticated signup would leak the roster.
 */
export async function attributeReferral(params: {
  referredShopId: string;
  referredUserId: string;
  referredEmail: string;
  rawCode: string | null | undefined;
}): Promise<AttributionOutcome> {
  const code = params.rawCode ? normalizeReferralCode(params.rawCode) : null;
  if (!code) return "no_code";

  const db = getDb();

  const found = await db
    .select({
      id: partners.id,
      status: partners.status,
      userId: partners.userId,
      shopId: partners.shopId,
      email: user.email,
    })
    .from(partners)
    .innerJoin(user, eq(user.id, partners.userId))
    .where(eq(partners.code, code))
    .limit(1);

  const partner = maybeRow(found);
  if (!partner) return "unknown_code";
  if (!canEarn(partner.status)) return "unknown_code";

  if (partner.userId === params.referredUserId) return "self";
  if (partner.shopId && partner.shopId === params.referredShopId) return "self";
  if (partner.email.toLowerCase() === params.referredEmail.toLowerCase()) {
    return "self";
  }

  const inserted = await db
    .insert(creatorReferrals)
    .values({
      partnerId: partner.id,
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
 * Appends the partner's cut of one paid platform invoice.
 *
 * Called only from the platform webhook. Idempotent by constraint: Stripe
 * delivers at least once, and the `(stripe_invoice_id, kind)` unique index
 * plus `ON CONFLICT DO NOTHING` makes the second delivery add nothing. A
 * read-then-write would let two concurrent deliveries both pass.
 *
 * The rate is resolved *now* and written onto the row. A partner on a
 * negotiated rate gets theirs, everyone else gets the programme's, and neither
 * can be restated later by changing a setting — see
 * `referralEarnings.commissionBp`.
 *
 * A suspended partner earns nothing. Their links stopped attributing the day
 * they were suspended, but the creators they brought *before* that are still
 * paying us every month, and those invoices must stop generating commission
 * too or suspension means nothing.
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
  const db = getDb();

  const found = await db
    .select({
      referralId: creatorReferrals.id,
      convertedAt: creatorReferrals.convertedAt,
      partnerStatus: partners.status,
      partnerCommissionBp: partners.commissionBp,
    })
    .from(creatorReferrals)
    .innerJoin(partners, eq(partners.id, creatorReferrals.partnerId))
    .where(eq(creatorReferrals.referredShopId, params.referredShopId))
    .limit(1);

  const referral = maybeRow(found);
  if (!referral) return false;
  if (!canEarn(referral.partnerStatus)) return false;

  const settings = await getProgramSettings();
  const bp = resolveCommissionBp(
    referral.partnerCommissionBp,
    settings.commissionBp,
  );

  // A trial, a fully-discounted invoice, a $0 proration or a 0% partner all
  // earn nothing, and none of them is worth a ledger row.
  const amountCents = commissionCents(params.invoiceAmountCents, bp);
  if (amountCents <= 0) return false;

  const now = new Date();
  const inserted = await db
    .insert(referralEarnings)
    .values({
      referralId: referral.referralId,
      stripeInvoiceId: params.stripeInvoiceId,
      kind: "earning",
      amountCents,
      currency: params.currency.toUpperCase(),
      commissionBp: bp,
      matureAt: maturityDate(now, settings.holdDays),
    })
    .onConflictDoNothing({
      target: [referralEarnings.stripeInvoiceId, referralEarnings.kind],
    })
    .returning({ id: referralEarnings.id });

  if (inserted.length === 0) return false;

  /*
   * "Converted" is the first invoice, not the latest one. Guarded by the
   * `is null` so a replay or a second month cannot move the date — the
   * partner's dashboard reads "converted on…" and that has to stay the day it
   * happened.
   */
  if (!referral.convertedAt) {
    await db
      .update(creatorReferrals)
      .set({ convertedAt: now })
      .where(
        and(
          eq(creatorReferrals.id, referral.referralId),
          isNull(creatorReferrals.convertedAt),
        ),
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
 * Sized on what was actually refunded *at the rate the earning used*, so a
 * partial refund reverses a partial commission and a rate change between the
 * two events cannot make the reversal disagree with the earning. Clamped to
 * the earning it undoes — a refund larger than the invoice we commissioned
 * would otherwise claw back money that was never paid.
 *
 * The reversal matures immediately, whatever the hold period is. A clawback
 * that sat in hold would leave the available balance untouched for a month
 * while we paid out money we had already given back.
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

  const share = Math.min(
    commissionCents(params.refundedCents, earning.commissionBp),
    earning.amountCents,
  );
  if (share <= 0) return false;

  /*
   * `refundedCents` is the *cumulative* total on the charge, not this refund's
   * increment, so the reversal has to converge on the true total rather than
   * append one row per event. Inserting a fresh `reversal` and dropping it on
   * conflict would mean a first $20 refund reversed its commission, and a
   * later refund of the remaining $80 hit the unique `(invoice, kind)` index
   * and was silently discarded — leaving the partner paid on money we gave
   * back in full.
   *
   * So the one reversal row per invoice is updated to match the cumulative
   * refund. Replay-safety does not depend on this: every webhook event is
   * fenced by `claimEvent` at the route before it reaches here, so the same
   * event never runs twice. `setWhere` (both amounts are negative, so the more
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
      commissionBp: earning.commissionBp,
      matureAt: new Date(),
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
/*  What the partner sees                                                      */
/* -------------------------------------------------------------------------- */

export type PartnerSummary = PartnerBalance & {
  /** Signups that came through this partner's link. */
  referredCount: number;
  /** Of those, the ones now paying Sailo. */
  convertedCount: number;
  /** The ledger's currency, or null while it is empty. */
  currency: string | null;
};

/** Every ledger row for one partner, oldest question first: what are we at. */
export async function getPartnerSummary(
  partnerId: string,
  minimumCents: number,
): Promise<PartnerSummary> {
  const db = getDb();

  const [counts, ledger] = await Promise.all([
    db
      .select({
        referred: sql<string>`count(*)`,
        converted: sql<string>`count(*) filter (where ${creatorReferrals.convertedAt} is not null)`,
      })
      .from(creatorReferrals)
      .where(eq(creatorReferrals.partnerId, partnerId)),

    db
      .select({
        amountCents: referralEarnings.amountCents,
        currency: referralEarnings.currency,
        matureAt: referralEarnings.matureAt,
        paidOutAt: referralEarnings.paidOutAt,
      })
      .from(referralEarnings)
      .innerJoin(
        creatorReferrals,
        eq(creatorReferrals.id, referralEarnings.referralId),
      )
      .where(eq(creatorReferrals.partnerId, partnerId))
      .orderBy(desc(referralEarnings.createdAt)),
  ]);

  const row = maybeRow(counts);
  return {
    ...partnerBalance(ledger, minimumCents),
    referredCount: Number(row?.referred ?? 0),
    convertedCount: Number(row?.converted ?? 0),
    currency: ledgerCurrency(ledger),
  };
}

export type PartnerCard =
  /** Not in the programme, or still waiting on a decision. */
  | { state: "join" | "pending" | "rejected"; commissionBp: number }
  /** In, with a link to share and a ledger to show. */
  | {
      state: "active";
      commissionBp: number;
      code: string;
      summary: PartnerSummary;
      minimumCents: number;
    };

/**
 * What the seller dashboard's partner card needs, in one call.
 *
 * One function rather than three awaits in the dashboard's `Promise.all`,
 * because the second and third depend on the first: a seller who is not a
 * partner has no ledger to sum, and firing the summary query for them anyway
 * would be a join across the whole earnings table returning nothing.
 *
 * A suspended partner is shown the `rejected` card rather than a live link.
 * Their code still resolves for links already posted — that is deliberate, see
 * `partners_approved_has_code` — but the dashboard should not invite them to
 * post more.
 */
export async function getPartnerCard(userId: string): Promise<PartnerCard> {
  const settings = await getProgramSettings();

  const partner = await getDb().query.partners.findFirst({
    where: eq(partners.userId, userId),
    columns: { id: true, status: true, code: true, commissionBp: true },
  });

  const commissionBp = resolveCommissionBp(
    partner?.commissionBp,
    settings.commissionBp,
  );

  if (!partner) return { state: "join", commissionBp };
  if (partner.status === "pending") return { state: "pending", commissionBp };
  if (!canEarn(partner.status) || !partner.code) {
    return { state: "rejected", commissionBp };
  }

  return {
    state: "active",
    commissionBp,
    code: partner.code,
    summary: await getPartnerSummary(partner.id, settings.payoutMinimumCents),
    minimumCents: settings.payoutMinimumCents,
  };
}

export type ReferredCreator = {
  shopName: string;
  shopHandle: string;
  attributedAt: Date;
  convertedAt: Date | null;
  /** What this one creator has earned the partner, lifetime. */
  earnedCents: number;
  currency: string | null;
};

/**
 * The creators one partner brought, newest first.
 *
 * Names and handles only. A partner is owed a truthful account of what they
 * earned and from whom, and nothing beyond it: no email address, no plan, no
 * revenue figure for a business that is not theirs.
 */
export async function getReferredCreators(
  partnerId: string,
  limit = 50,
): Promise<ReferredCreator[]> {
  const rows = await getDb()
    .select({
      shopName: shops.name,
      shopHandle: shops.handle,
      attributedAt: creatorReferrals.attributedAt,
      convertedAt: creatorReferrals.convertedAt,
      earnedCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}), 0)`,
      currency: sql<string | null>`max(${referralEarnings.currency})`,
    })
    .from(creatorReferrals)
    .innerJoin(shops, eq(shops.id, creatorReferrals.referredShopId))
    .leftJoin(
      referralEarnings,
      eq(referralEarnings.referralId, creatorReferrals.id),
    )
    .where(eq(creatorReferrals.partnerId, partnerId))
    .groupBy(
      creatorReferrals.id,
      shops.name,
      shops.handle,
      creatorReferrals.attributedAt,
      creatorReferrals.convertedAt,
    )
    .orderBy(desc(creatorReferrals.attributedAt))
    .limit(limit);

  return rows.map((row) => ({
    shopName: row.shopName,
    shopHandle: row.shopHandle,
    attributedAt: row.attributedAt,
    convertedAt: row.convertedAt,
    earnedCents: Number(row.earnedCents),
    currency: row.currency,
  }));
}
