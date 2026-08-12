import "server-only";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  creatorReferrals,
  partnerPayouts,
  partners,
  referralEarnings,
  shops,
  user,
} from "@/db/schema";
import { maybeRow } from "@/lib/invariant";
import { requireStaff } from "@/lib/session";
import {
  canBePaid,
  hasLiveSubscription,
  payoutBlocker,
  type PayoutBlocker,
} from "@/lib/partners/eligibility";
import { getProgramSettings } from "@/lib/partners/settings";
import { isPayableBalance, resolveCommissionBp } from "@/lib/partners/program";


/**
 * The partner programme as /hq sees it: who applied, who earns, what we owe.
 *
 * Distinct from /hq/affiliates, which is commission a *seller* owes someone
 * for selling their products — money that never passes through us. This is our
 * own liability, paid out of our subscription revenue.
 *
 * `requireStaff()` in every exported read, not only in the /hq layout: Next
 * renders a layout and its page in parallel, so a layout's refusal is no proof
 * this read never ran.
 */

export type PartnerRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  code: string | null;
  /** The rate actually in force for them, override or programme default. */
  commissionBp: number;
  /** True when the rate is a negotiated one rather than the default. */
  hasCustomRate: boolean;
  shopHandle: string | null;
  website: string | null;
  audience: string | null;
  referredCount: number;
  convertedCount: number;
  lifetimeCents: number;
  paidCents: number;
  /** Unpaid and out of hold — what we could send today. */
  availableCents: number;
  /** Unpaid and still inside the hold period. */
  heldCents: number;
  currency: string;
  payable: boolean;
  /** Whether their shop's Stripe account would accept the transfer. */
  connectReady: boolean;
  /** Null when payable; otherwise what they have to finish. */
  payoutBlocker: PayoutBlocker | null;
  /** Whether their Sailo subscription is live, which is what lets them accrue. */
  subscribed: boolean;
  /** Their shop's Stripe country, worth showing on the detail page. */
  stripeAccountCountry: string | null;
  appliedAt: Date;
  lastEarnedAt: Date | null;
};

/**
 * Every partner, with their whole ledger folded in.
 *
 * One grouped query rather than a roster query plus a balance query per row:
 * this page shows the entire programme and the N+1 version would be a hundred
 * round trips on a list of a hundred partners.
 *
 * The `left join` matters — an applicant who has never earned anything must
 * still appear, which is the entire point of a page that shows applications.
 */
export async function getPartners(filter?: {
  status?: string;
}): Promise<PartnerRow[]> {
  await requireStaff();
  const settings = await getProgramSettings();
  const now = new Date();

  const rows = await getDb()
    .select({
      id: partners.id,
      name: partners.name,
      email: user.email,
      status: partners.status,
      code: partners.code,
      commissionBp: partners.commissionBp,
      website: partners.website,
      audience: partners.audience,
      appliedAt: partners.appliedAt,
      /*
       * Their shop is now both the subscription test and the payout
       * destination, so the roster reads it instead of a second Stripe account
       * per partner.
       */
      shopHandle: shops.handle,
      shopPlan: shops.plan,
      shopSubscriptionStatus: shops.subscriptionStatus,
      shopCompPlan: shops.compPlan,
      shopStripeAccountId: shops.stripeAccountId,
      shopStripeChargesEnabled: shops.stripeChargesEnabled,
      shopStripeCountry: shops.stripeAccountCountry,

      referredCount: sql<string>`count(distinct ${creatorReferrals.id})`,
      convertedCount: sql<string>`count(distinct ${creatorReferrals.id}) filter (where ${creatorReferrals.convertedAt} is not null)`,
      lifetimeCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}), 0)`,
      paidCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}) filter (where ${referralEarnings.paidOutAt} is not null), 0)`,
      availableCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}) filter (where ${referralEarnings.paidOutAt} is null and ${referralEarnings.matureAt} <= ${now}), 0)`,
      heldCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}) filter (where ${referralEarnings.paidOutAt} is null and ${referralEarnings.matureAt} > ${now}), 0)`,
      currency: sql<string | null>`max(${referralEarnings.currency})`,
      lastEarnedAt: sql<Date | null>`max(${referralEarnings.createdAt})`,
    })
    .from(partners)
    .innerJoin(user, eq(user.id, partners.userId))
    .leftJoin(shops, eq(shops.id, partners.shopId))
    .leftJoin(creatorReferrals, eq(creatorReferrals.partnerId, partners.id))
    .leftJoin(
      referralEarnings,
      eq(referralEarnings.referralId, creatorReferrals.id),
    )
    .where(filter?.status ? eq(partners.status, filter.status) : undefined)
    .groupBy(partners.id, user.email, shops.handle)
    .orderBy(
      /*
       * Applications first, then by what we owe. The queue is the thing this
       * page exists to clear; a pending application buried under forty earning
       * partners is an application nobody answers.
       */
      sql`case when ${partners.status} = 'pending' then 0 else 1 end`,
      desc(
        sql`coalesce(sum(${referralEarnings.amountCents}) filter (where ${referralEarnings.paidOutAt} is null and ${referralEarnings.matureAt} <= ${now}), 0)`,
      ),
      desc(partners.appliedAt),
    );

  return rows.map((row) => {
    const availableCents = Number(row.availableCents);
    /*
     * Built once and handed to every predicate, so the roster cannot show a
     * partner as subscribed by one test and lapsed by another.
     */
    const shop = row.shopPlan
      ? {
          plan: row.shopPlan,
          subscriptionStatus: row.shopSubscriptionStatus,
          compPlan: row.shopCompPlan,
          stripeAccountId: row.shopStripeAccountId,
          stripeChargesEnabled: row.shopStripeChargesEnabled ?? false,
        }
      : null;

    return {
      id: row.id,
      name: row.name,
      email: row.email,
      status: row.status,
      code: row.code,
      commissionBp: resolveCommissionBp(row.commissionBp, settings.commissionBp),
      hasCustomRate: row.commissionBp !== null,
      shopHandle: row.shopHandle,
      website: row.website,
      audience: row.audience,
      referredCount: Number(row.referredCount),
      convertedCount: Number(row.convertedCount),
      lifetimeCents: Number(row.lifetimeCents),
      paidCents: Number(row.paidCents),
      availableCents,
      heldCents: Number(row.heldCents),
      currency: row.currency ?? "USD",
      payable: isPayableBalance(availableCents, settings.payoutMinimumCents),
      connectReady: canBePaid(shop),
      payoutBlocker: payoutBlocker(shop),
      subscribed: hasLiveSubscription(shop),
      stripeAccountCountry: row.shopStripeCountry,
      appliedAt: row.appliedAt,
      lastEarnedAt: row.lastEarnedAt ? new Date(row.lastEarnedAt) : null,
    };
  });
}

/** Programme totals for the page header. */
export async function getProgramTotals(): Promise<{
  approved: number;
  pending: number;
  referred: number;
  converted: number;
  owedCents: number;
  paidCents: number;
  currency: string;
}> {
  await requireStaff();
  const now = new Date();
  const db = getDb();

  const [roster, ledger] = await Promise.all([
    db
      .select({
        approved: sql<string>`count(*) filter (where ${partners.status} = 'approved')`,
        pending: sql<string>`count(*) filter (where ${partners.status} = 'pending')`,
      })
      .from(partners),
    db
      .select({
        referred: sql<string>`count(distinct ${creatorReferrals.id})`,
        converted: sql<string>`count(distinct ${creatorReferrals.id}) filter (where ${creatorReferrals.convertedAt} is not null)`,
        owedCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}) filter (where ${referralEarnings.paidOutAt} is null and ${referralEarnings.matureAt} <= ${now}), 0)`,
        paidCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}) filter (where ${referralEarnings.paidOutAt} is not null), 0)`,
        currency: sql<string | null>`max(${referralEarnings.currency})`,
      })
      .from(creatorReferrals)
      .leftJoin(
        referralEarnings,
        eq(referralEarnings.referralId, creatorReferrals.id),
      ),
  ]);

  const r = maybeRow(roster);
  const l = maybeRow(ledger);

  return {
    approved: Number(r?.approved ?? 0),
    pending: Number(r?.pending ?? 0),
    referred: Number(l?.referred ?? 0),
    converted: Number(l?.converted ?? 0),
    owedCents: Number(l?.owedCents ?? 0),
    paidCents: Number(l?.paidCents ?? 0),
    currency: l?.currency ?? "USD",
  };
}

/* -------------------------------------------------------------------------- */
/*  One partner, in full                                                       */
/* -------------------------------------------------------------------------- */

export type PartnerDetail = {
  partner: PartnerRow;
  notes: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  pitch: string | null;
  referrals: {
    shopName: string;
    shopHandle: string;
    attributedAt: Date;
    convertedAt: Date | null;
    earnedCents: number;
  }[];
  earnings: {
    id: string;
    kind: string;
    amountCents: number;
    currency: string;
    commissionBp: number;
    stripeInvoiceId: string;
    createdAt: Date;
    matureAt: Date;
    paidOutAt: Date | null;
  }[];
  payouts: {
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    failureReason: string | null;
    initiatedBy: string;
    initiatedByEmail: string | null;
    stripeTransferId: string | null;
    createdAt: Date;
    paidAt: Date | null;
  }[];
};

export async function getPartnerDetail(
  partnerId: string,
): Promise<PartnerDetail | null> {
  await requireStaff();
  const db = getDb();

  const rows = await getPartners();
  const partner = rows.find((row) => row.id === partnerId);
  if (!partner) return null;

  const meta = await db.query.partners.findFirst({
    where: eq(partners.id, partnerId),
    columns: {
      notes: true,
      reviewNote: true,
      reviewedBy: true,
      reviewedAt: true,
      pitch: true,
    },
  });

  const [referrals, earnings, payouts] = await Promise.all([
    db
      .select({
        shopName: shops.name,
        shopHandle: shops.handle,
        attributedAt: creatorReferrals.attributedAt,
        convertedAt: creatorReferrals.convertedAt,
        earnedCents: sql<string>`coalesce(sum(${referralEarnings.amountCents}), 0)`,
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
      .orderBy(desc(creatorReferrals.attributedAt)),

    db
      .select({
        id: referralEarnings.id,
        kind: referralEarnings.kind,
        amountCents: referralEarnings.amountCents,
        currency: referralEarnings.currency,
        commissionBp: referralEarnings.commissionBp,
        stripeInvoiceId: referralEarnings.stripeInvoiceId,
        createdAt: referralEarnings.createdAt,
        matureAt: referralEarnings.matureAt,
        paidOutAt: referralEarnings.paidOutAt,
      })
      .from(referralEarnings)
      .innerJoin(
        creatorReferrals,
        eq(creatorReferrals.id, referralEarnings.referralId),
      )
      .where(eq(creatorReferrals.partnerId, partnerId))
      .orderBy(desc(referralEarnings.createdAt))
      .limit(100),

    db
      .select({
        id: partnerPayouts.id,
        amountCents: partnerPayouts.amountCents,
        currency: partnerPayouts.currency,
        status: partnerPayouts.status,
        failureReason: partnerPayouts.failureReason,
        initiatedBy: partnerPayouts.initiatedBy,
        initiatedByEmail: partnerPayouts.initiatedByEmail,
        stripeTransferId: partnerPayouts.stripeTransferId,
        createdAt: partnerPayouts.createdAt,
        paidAt: partnerPayouts.paidAt,
      })
      .from(partnerPayouts)
      .where(eq(partnerPayouts.partnerId, partnerId))
      .orderBy(desc(partnerPayouts.createdAt))
      .limit(50),
  ]);

  return {
    partner,
    notes: meta?.notes ?? null,
    reviewNote: meta?.reviewNote ?? null,
    reviewedBy: meta?.reviewedBy ?? null,
    reviewedAt: meta?.reviewedAt ?? null,
    pitch: meta?.pitch ?? null,
    referrals: referrals.map((r) => ({
      shopName: r.shopName,
      shopHandle: r.shopHandle,
      attributedAt: r.attributedAt,
      convertedAt: r.convertedAt,
      earnedCents: Number(r.earnedCents),
    })),
    earnings,
    payouts,
  };
}

/* -------------------------------------------------------------------------- */
/*  The payout run, as /hq sees it                                             */
/* -------------------------------------------------------------------------- */

/**
 * Everything the payouts page needs to show what a run would do before anyone
 * presses the button.
 *
 * Split into what we *can* send and what we can't, because "owed but stuck" is
 * the number that actually needs a human — a partner sitting on $400 they can't
 * receive because they never finished Connect onboarding is a support problem,
 * not a payout problem, and it should not be hidden inside a total.
 */
export async function getPayoutPreview(): Promise<{
  ready: PartnerRow[];
  blocked: PartnerRow[];
  belowMinimum: PartnerRow[];
  readyTotalCents: number;
  blockedTotalCents: number;
  minimumCents: number;
  currency: string;
  pendingPayouts: number;
}> {
  await requireStaff();
  const settings = await getProgramSettings();

  const all = await getPartners();
  const owed = all.filter((row) => row.availableCents > 0);

  const ready = owed.filter((row) => row.payable && row.connectReady);
  const blocked = owed.filter((row) => row.payable && !row.connectReady);
  const belowMinimum = owed.filter((row) => !row.payable);

  const pending = maybeRow(
    await getDb()
      .select({ n: sql<string>`count(*)` })
      .from(partnerPayouts)
      .where(eq(partnerPayouts.status, "pending")),
  );

  return {
    ready,
    blocked,
    belowMinimum,
    readyTotalCents: ready.reduce((sum, row) => sum + row.availableCents, 0),
    blockedTotalCents: blocked.reduce((sum, row) => sum + row.availableCents, 0),
    minimumCents: settings.payoutMinimumCents,
    currency: owed[0]?.currency ?? "USD",
    pendingPayouts: Number(pending?.n ?? 0),
  };
}

/** Every payout ever attempted, newest first — the settlement history. */
export async function getRecentPayouts(limit = 100) {
  await requireStaff();

  return getDb()
    .select({
      id: partnerPayouts.id,
      partnerId: partnerPayouts.partnerId,
      partnerName: partners.name,
      amountCents: partnerPayouts.amountCents,
      currency: partnerPayouts.currency,
      status: partnerPayouts.status,
      failureReason: partnerPayouts.failureReason,
      initiatedBy: partnerPayouts.initiatedBy,
      initiatedByEmail: partnerPayouts.initiatedByEmail,
      stripeTransferId: partnerPayouts.stripeTransferId,
      createdAt: partnerPayouts.createdAt,
      paidAt: partnerPayouts.paidAt,
    })
    .from(partnerPayouts)
    .innerJoin(partners, eq(partners.id, partnerPayouts.partnerId))
    .orderBy(desc(partnerPayouts.createdAt))
    .limit(limit);
}

/**
 * Stamps a partner's matured rows as settled without moving any money.
 *
 * The escape hatch for a payment made outside Stripe — a wire, a correction,
 * a partner in a country Connect can't reach. It exists because the
 * alternative is a balance that can never be cleared and a payouts page that
 * grows a permanent row nobody can action.
 *
 * Idempotent by the `is null` in the WHERE, which is what makes a
 * double-clicked button harmless: the second press matches no rows rather than
 * re-stamping the first press's payout with a later date. Amounts are never
 * touched — the rows say what was earned; this says when it was settled.
 */
export async function markPaidManually(
  partnerId: string,
  actorEmail: string,
): Promise<{ rows: number; cents: number; currency: string | null }> {
  await requireStaff();

  const paid = await getDb()
    .update(referralEarnings)
    .set({ paidOutAt: new Date() })
    .where(
      and(
        isNull(referralEarnings.paidOutAt),
        isNull(referralEarnings.payoutId),
        lte(referralEarnings.matureAt, new Date()),
        sql`${referralEarnings.referralId} in (
          select ${creatorReferrals.id} from ${creatorReferrals}
          where ${creatorReferrals.partnerId} = ${partnerId}
        )`,
      ),
    )
    .returning({
      amountCents: referralEarnings.amountCents,
      currency: referralEarnings.currency,
    });

  const cents = paid.reduce((sum, row) => sum + row.amountCents, 0);

  /*
   * A payout row for the record, so the history shows *how* it was settled.
   * Without it, an off-Stripe payment is invisible: the balance simply drops
   * and nobody can say who cleared it or when.
   */
  const currency = paid[0]?.currency;
  if (cents > 0 && currency) {
    await getDb()
      .insert(partnerPayouts)
      .values({
        partnerId,
        amountCents: cents,
        currency,
        status: "paid",
        idempotencyKey: `manual-${crypto.randomUUID()}`,
        initiatedBy: "manual",
        initiatedByEmail: actorEmail,
        failureReason: null,
        paidAt: new Date(),
      });
  }

  return { rows: paid.length, cents, currency: paid[0]?.currency ?? null };
}
