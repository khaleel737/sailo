import "server-only";
import { requireStaff } from "@/lib/session";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb, getReadDb } from "@sailo/db";
import { disputes, orders, riskFlags, shopClosures, shops, user } from "@sailo/db/schema";
import { closureFingerprint } from "@sailo/account/fingerprint";
import { screenBusiness } from "@sailo/security/restricted-businesses";
import {
  assessRisk,
  worstSeverity,
  type RiskSeverity,
  type RiskSignal,
} from "@sailo/core/risk";
import { daysAgo, num } from "./pagination";

/**
 * The risk desk: which shops need reading, and why.
 *
 * ─── THE ONE DESIGN DECISION THAT MATTERS HERE ───────────────────────────────
 * The obvious implementation is "score every shop, sort by score, show the top
 * twenty-five". It is also the implementation that makes this page a full scan
 * of `shops` with eight correlated subqueries on it, every time anybody opens
 * the panel — and one that gets slower in exact proportion to how well the
 * platform is doing.
 *
 * It is avoided by turning the question round. Almost every shop on the
 * platform trips nothing, and the ones that trip something are, without
 * exception, shops that appear in a *small, indexed* table: they have a
 * dispute, or paid-and-undelivered orders, or a week of unusual volume, or a
 * flag somebody already raised, or a standing staff decision against them.
 * Those five lists are cheap to produce — each one is a grouped read over an
 * index that already exists for another reason — and their union is the
 * candidate set.
 *
 * So the shape is:
 *
 *   1. five bounded candidate queries, each over an index, each capped;
 *   2. one detail query over the union, which is tens of shops and not tens of
 *      thousands;
 *   3. the ladder in JavaScript, over that handful.
 *
 * The cost is bounded by how much is *wrong* with the platform rather than by
 * how large it is, which is the only way round for a screen that has to stay
 * usable on the worst day it will ever be opened.
 *
 * ─── WHAT THIS DELIBERATELY MISSES ───────────────────────────────────────────
 * A shop whose only problem is that its owner has closed a shop before, and
 * which has no orders, no disputes and no flags, is not a candidate — the
 * fingerprint match cannot be expressed in SQL, because the digest is an HMAC
 * under a key the database does not hold. `getReturningSellers` in `./closures`
 * is the screen that answers that question directly, and the account page runs
 * the match for one seller. Stated here rather than left to be discovered.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Each candidate query's own cap. Generous, and it is a cap. */
const CANDIDATE_LIMIT = 150;
/** How many scored rows the desk shows. Beyond this nobody is reading. */
const DESK_LIMIT = 50;

export type RiskRow = {
  shopId: string;
  ownerId: string;
  ownerEmail: string;
  shopName: string;
  handle: string;
  currency: string;
  severity: RiskSeverity;
  signals: RiskSignal[];
  suspendedAt: Date | null;
  payoutsPausedAt: Date | null;
  deletedAt: Date | null;
  openFlags: number;
};

/**
 * Shops that appear in a table that only troubled shops appear in.
 *
 * Five reads, in parallel, each capped. Returns a set of shop ids and nothing
 * else — the numbers are gathered once, for the union, in `describe` below,
 * because a shop that turns up in three of these lists must not be measured
 * three times.
 */
async function candidates(): Promise<Set<string>> {
  const db = getReadDb();
  const week = daysAgo(7);

  const [disputed, undelivered, busy, flagged, standing] = await Promise.all([
    // Any dispute, ever. `disputes_shop_idx` — and the table is small by nature.
    db
      .selectDistinct({ shopId: disputes.shopId })
      .from(disputes)
      .limit(CANDIDATE_LIMIT),

    // Paid and not delivered, five or more. `orders_shop_idx`.
    db
      .select({ shopId: orders.shopId })
      .from(orders)
      .where(
        and(
          eq(orders.paymentStatus, "paid"),
          inArray(orders.status, ["new", "confirmed"]),
        ),
      )
      .groupBy(orders.shopId)
      .having(sql`count(*) >= 5`)
      .limit(CANDIDATE_LIMIT),

    /*
     * A week with real money in it. `orders_created_idx` leads on the date, so
     * this reads one week of orders rather than the whole table — and the floor
     * is what keeps the candidate set small on a healthy platform, where most
     * shops take nothing in any given week.
     */
    db
      .select({ shopId: orders.shopId })
      .from(orders)
      .where(gte(orders.createdAt, week))
      .groupBy(orders.shopId)
      .having(sql`sum(${orders.totalCents}) >= 100000`)
      .limit(CANDIDATE_LIMIT),

    // Anything a human already raised and nobody has cleared.
    db
      .selectDistinct({ shopId: riskFlags.shopId })
      .from(riskFlags)
      .where(isNull(riskFlags.clearedAt))
      .limit(CANDIDATE_LIMIT),

    /*
     * A standing decision against them. These stay on the desk while they are
     * in force, deliberately: a suspended shop with the reason on screen is how
     * the next person finds out it is suspended, and a payout hold nobody
     * revisits is a seller's money sitting still for no recorded reason.
     */
    db
      .select({ shopId: shops.id })
      .from(shops)
      .where(
        sql`(${shops.suspendedAt} is not null or ${shops.payoutsPausedAt} is not null) and ${shops.deletedAt} is null`,
      )
      .limit(CANDIDATE_LIMIT),
  ]);

  const ids = new Set<string>();
  for (const list of [disputed, undelivered, busy, flagged, standing]) {
    for (const row of list) if (row.shopId) ids.add(row.shopId);
  }
  return ids;
}

/**
 * Everything the ladder needs, for a known set of shops.
 *
 * One query. Every aggregate is a correlated subquery scoped to a shop id that
 * is already in the `IN` list, so each one is an index lookup and there are at
 * most a few hundred of them.
 */
async function describe(shopIds: string[]) {
  const db = getReadDb();
  const week = daysAgo(7);
  const fortnight = daysAgo(14);

  return db
    .select({
      shopId: shops.id,
      ownerId: shops.userId,
      ownerEmail: user.email,
      shopName: shops.name,
      handle: shops.handle,
      description: shops.description,
      currency: shops.currency,
      createdAt: shops.createdAt,
      suspendedAt: shops.suspendedAt,
      payoutsPausedAt: shops.payoutsPausedAt,
      deletedAt: shops.deletedAt,
      stripeChargesEnabled: shops.stripeChargesEnabled,
      stripeAccountCountry: shops.stripeAccountCountry,
      twoFactorEnabled: user.twoFactorEnabled,

      grossCents: sql<string>`(select coalesce(sum(o.total_cents), 0) from orders o where o.shop_id = ${shops.id} and o.status <> 'cancelled')`,
      refundedCents: sql<string>`(select coalesce(sum(o.refunded_cents), 0) from orders o where o.shop_id = ${shops.id})`,
      // The same denominator `settled()` uses in @sailo/commerce. A rate whose
      // numerator and denominator come from two different definitions of
      // "a transaction" is not a rate.
      settledOrders: sql<string>`(select count(*) from orders o where o.shop_id = ${shops.id} and o.payment_status in ('paid', 'refunded', 'disputed'))`,

      undeliveredOrders: sql<string>`(select count(*) from orders o where o.shop_id = ${shops.id} and o.payment_status = 'paid' and o.status in ('new', 'confirmed'))`,
      undeliveredCents: sql<string>`(select coalesce(sum(o.total_cents - o.refunded_cents), 0) from orders o where o.shop_id = ${shops.id} and o.payment_status = 'paid' and o.status in ('new', 'confirmed'))`,

      /*
       * Chargebacks only, and the test is `status not like 'warning\_%'` —
       * verbatim from `cohortRows` in `@sailo/commerce/disputes/stats`, which
       * is the query the seller's own rate is computed by.
       *
       * Written out again rather than shared, because sharing it would make
       * this panel depend on `@sailo/commerce` for one predicate. That trade is
       * only acceptable because the two agree exactly, so: not `case_type <>
       * 'inquiry'`, which looks equivalent and is not — the column is nullable,
       * and `NULL <> 'inquiry'` is NULL, so every dispute recorded before Stripe
       * told us the case type would silently drop out of the count and flatter
       * the rate.
       *
       * `scope = 'connected'` for the reason that query gives: a seller
       * charging back their own Sailo subscription is a dispute against Sailo's
       * balance, and counting it here would let a billing argument hold their
       * payouts.
       */
      chargebacks: sql<string>`(select count(*) from disputes d where d.shop_id = ${shops.id} and d.scope = 'connected' and d.status not like 'warning\_%')`,
      openDisputes: sql<string>`(select count(*) from disputes d where d.shop_id = ${shops.id} and d.status in ('needs_response', 'under_review'))`,
      openDisputeCents: sql<string>`(select coalesce(sum(d.amount_cents), 0) from disputes d where d.shop_id = ${shops.id} and d.status in ('needs_response', 'under_review'))`,

      recentCents: sql<string>`(select coalesce(sum(o.total_cents), 0) from orders o where o.shop_id = ${shops.id} and o.created_at >= ${week} and o.status <> 'cancelled')`,
      priorCents: sql<string>`(select coalesce(sum(o.total_cents), 0) from orders o where o.shop_id = ${shops.id} and o.created_at >= ${fortnight} and o.created_at < ${week} and o.status <> 'cancelled')`,

      openFlags: sql<string>`(select count(*) from risk_flags f where f.shop_id = ${shops.id} and f.cleared_at is null)`,
    })
    .from(shops)
    .innerJoin(user, eq(user.id, shops.userId))
    .where(inArray(shops.id, shopIds));
}

/**
 * How many shops this owner has closed before, keyed by fingerprint.
 *
 * One query for the whole page rather than one per row. The digests are
 * computed here, in JavaScript, because they are HMACs under a key the database
 * does not hold — which is the point of them.
 */
async function priorClosures(
  emails: readonly string[],
): Promise<Map<string, { total: number; suspicion: number }>> {
  const key = process.env.BETTER_AUTH_SECRET;
  const byDigest = new Map<string, string>();
  if (key) {
    for (const email of emails) {
      const digest = closureFingerprint(email, key);
      if (digest) byDigest.set(digest, email);
    }
  }
  if (byDigest.size === 0) return new Map();

  const rows = await getReadDb()
    .select({
      hash: shopClosures.ownerEmailHash,
      total: sql<string>`count(*)`,
      suspicion: sql<string>`count(*) filter (where ${shopClosures.identityRetained} = 'suspicion')`,
    })
    .from(shopClosures)
    .where(inArray(shopClosures.ownerEmailHash, [...byDigest.keys()]))
    .groupBy(shopClosures.ownerEmailHash);

  const out = new Map<string, { total: number; suspicion: number }>();
  for (const row of rows) {
    const email = row.hash ? byDigest.get(row.hash) : undefined;
    if (email) out.set(email, { total: num(row.total), suspicion: num(row.suspicion) });
  }
  return out;
}

/** Basis points, with the zero-denominator case answered rather than divided. */
const bp = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 10_000) : 0;

/**
 * The desk, assembled.
 *
 * `severity` filters the *result* rather than the candidate set, because the
 * ladder is what decides severity and the ladder runs in JavaScript. That is
 * fine: the result is already at most a few hundred rows.
 */
export async function getRiskDesk(filters: { severity?: string } = {}) {
  await requireStaff();

  const ids = [...(await candidates())];
  if (ids.length === 0) {
    return { rows: [] as RiskRow[], scanned: 0, counts: { act: 0, review: 0, watch: 0 } };
  }

  const described = await describe(ids);
  const closures = await priorClosures(described.map((row) => row.ownerEmail));

  const rows: RiskRow[] = [];
  for (const row of described) {
    const grossCents = num(row.grossCents);
    const refundedCents = num(row.refundedCents);
    const prior = closures.get(row.ownerEmail) ?? { total: 0, suspicion: 0 };

    /*
     * The restricted-business screen, over the two strings a seller writes
     * about themselves. It is the same matcher `connectStripe` runs at
     * onboarding — but a shop that was clear when it connected can rewrite its
     * description the following week, and nothing re-reads it. This is that
     * re-read, and it is why the screen is on the desk rather than only at the
     * door.
     */
    const screen = screenBusiness({
      text: [row.shopName, row.description],
      country: row.stripeAccountCountry,
    });

    const signals = assessRisk({
      chargebackBp: bp(num(row.chargebacks), num(row.settledOrders)),
      settledOrders: num(row.settledOrders),
      openDisputes: num(row.openDisputes),
      openDisputeCents: num(row.openDisputeCents),
      undeliveredPaidOrders: num(row.undeliveredOrders),
      undeliveredPaidCents: num(row.undeliveredCents),
      refundBp: bp(refundedCents, grossCents),
      recentCents: num(row.recentCents),
      priorCents: num(row.priorCents),
      ageDays: Math.floor((Date.now() - row.createdAt.getTime()) / 86_400_000),
      restricted: screen.decision,
      restrictedTerms: screen.matches.map((m) => m.term),
      priorClosures: prior.total,
      priorClosuresUnderSuspicion: prior.suspicion,
      twoFactorEnabled: row.twoFactorEnabled ?? false,
      chargesEnabled: row.stripeChargesEnabled,
      grossCents,
      currency: row.currency,
    });

    const severity = worstSeverity(signals);
    /*
     * A shop that was a candidate and trips nothing is dropped, and that is the
     * desk working rather than a gap. Being in `disputes` is what makes a shop
     * worth *measuring*; it is not what makes it worth reading about. The one
     * exception is a standing staff decision, which stays visible while it is
     * in force — see the note on the candidate query.
     */
    const standing = row.suspendedAt !== null || row.payoutsPausedAt !== null;
    if (!severity && !standing) continue;

    rows.push({
      shopId: row.shopId,
      ownerId: row.ownerId,
      ownerEmail: row.ownerEmail,
      shopName: row.shopName,
      handle: row.handle,
      currency: row.currency,
      severity: severity ?? "watch",
      signals,
      suspendedAt: row.suspendedAt,
      payoutsPausedAt: row.payoutsPausedAt,
      deletedAt: row.deletedAt,
      openFlags: num(row.openFlags),
    });
  }

  const rank = { act: 2, review: 1, watch: 0 } as const;
  rows.sort((a, b) => rank[b.severity] - rank[a.severity] || b.signals.length - a.signals.length);

  const counts = {
    act: rows.filter((r) => r.severity === "act").length,
    review: rows.filter((r) => r.severity === "review").length,
    watch: rows.filter((r) => r.severity === "watch").length,
  };

  /*
   * `needs-work` is the default and is not a severity — it is "everything that
   * is not merely a watch", which is the set somebody on shift is actually
   * working. Kept here rather than expressed as two query params, because the
   * caller should be able to link to `?severity=needs-work` and get the desk's
   * own idea of the queue rather than having to know its thresholds.
   */
  const filtered =
    filters.severity === "needs-work"
      ? rows.filter((r) => r.severity !== "watch")
      : filters.severity && filters.severity !== "all"
        ? rows.filter((r) => r.severity === filters.severity)
        : rows;

  return { rows: filtered.slice(0, DESK_LIMIT), scanned: ids.length, counts };
}

/**
 * One shop's risk picture, for its account page.
 *
 * Deliberately the same `describe` + `assessRisk` path the desk runs, over a
 * single id. Two implementations of "how risky is this shop" is how a shop
 * comes to look clean on its own page and alarming on the list.
 */
export async function getShopRisk(shopId: string) {
  await requireStaff();

  const [row] = await describe([shopId]);
  if (!row) return null;

  const closures = await priorClosures([row.ownerEmail]);
  const prior = closures.get(row.ownerEmail) ?? { total: 0, suspicion: 0 };
  const grossCents = num(row.grossCents);

  const screen = screenBusiness({
    text: [row.shopName, row.description],
    country: row.stripeAccountCountry,
  });

  const signals = assessRisk({
    chargebackBp: bp(num(row.chargebacks), num(row.settledOrders)),
    settledOrders: num(row.settledOrders),
    openDisputes: num(row.openDisputes),
    openDisputeCents: num(row.openDisputeCents),
    undeliveredPaidOrders: num(row.undeliveredOrders),
    undeliveredPaidCents: num(row.undeliveredCents),
    refundBp: bp(num(row.refundedCents), grossCents),
    recentCents: num(row.recentCents),
    priorCents: num(row.priorCents),
    ageDays: Math.floor((Date.now() - row.createdAt.getTime()) / 86_400_000),
    restricted: screen.decision,
    restrictedTerms: screen.matches.map((m) => m.term),
    priorClosures: prior.total,
    priorClosuresUnderSuspicion: prior.suspicion,
    twoFactorEnabled: row.twoFactorEnabled ?? false,
    chargesEnabled: row.stripeChargesEnabled,
    grossCents,
    currency: row.currency,
  });

  return {
    signals,
    severity: worstSeverity(signals),
    flags: await listFlags(shopId),
  } as const;
}

/** Every flag on a shop, open first, then the cleared ones as the record. */
export async function listFlags(shopId: string) {
  return getDb()
    .select()
    .from(riskFlags)
    .where(eq(riskFlags.shopId, shopId))
    .orderBy(sql`(${riskFlags.clearedAt} is not null)`, desc(riskFlags.raisedAt))
    .limit(30);
}
