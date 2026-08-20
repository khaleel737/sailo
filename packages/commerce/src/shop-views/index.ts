import "server-only";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { likePattern } from "@sailo/db/like";
import {
  affiliates,
  orders,
  paymentMethods,
  type Affiliate,
} from "@sailo/db/schema";

/**
 * One shop, read as an outsider reads it.
 *
 * These three were `apps/web/src/lib/queries` — the seller's own dashboard —
 * until the staff panel became apps/hq and needed the same three answers about
 * somebody else's shop. An app cannot import another app, and these are plain
 * shop-scoped reads with no session, no cache tag and no Next in them, so this
 * is where they belong.
 *
 * WHY THESE THREE AND NOT THE WHOLE MODULE
 * The rest of what the staff account page shows already lived in packages:
 * dashboard figures and the two series are `@sailo/analytics`, coupons and
 * delivery are elsewhere in this package, and the customer roster is
 * `@sailo/customers/roster`. Only these had never been needed twice before.
 *
 * WHAT DELIBERATELY DID NOT COME
 * `getShopFacets`, `getShopByHandle`, `getShopCategories`, `getPublicProducts`
 * and `getCheckoutMethods` are `"use cache"` functions carrying `cacheTag`, and
 * they stayed in apps/web. They are tuned for storefront traffic, and apps/hq
 * does not enable `cacheComponents` at all — staff looking at a seller's shop
 * want what is true now, not a copy sized for a cache. Do not move them here
 * to "finish the job": the caching is the point of those, and it does not
 * travel.
 *
 * apps/web still names all three through `@/lib/queries`, which re-exports
 * them, so nothing on the seller side changed.
 */

export type AffiliateRow = Affiliate & {
  orderCount: number;
  salesCents: number;
  earnedCents: number;
  unpaidCents: number;
};

/**
 * The affiliate lifecycle, coloured the same way in both panels.
 *
 * The seller's page and /hq each carried a copy of this mapping — the
 * duplicated-constant shape, where a fourth status added to the lifecycle
 * shows green on one screen and grey on the other with nothing failing.
 * The *labels* stay per app on purpose: the seller's are translated and
 * staff's name the feature.
 */
export const AFFILIATE_STATUS_TONES = {
  active: "green",
  pending: "amber",
  disabled: "neutral",
} as const;
export type AffiliateStatus = keyof typeof AFFILIATE_STATUS_TONES;

/** The referral programme: who promotes a shop and what they have earned. */
export async function getShopAffiliates(shopId: string): Promise<AffiliateRow[]> {
  const rows = await getDb()
    .select({
      affiliate: affiliates,
      orderCount: sql<string>`count(${orders.id})`,
      salesCents: sql<string>`coalesce(sum(${orders.totalCents}), 0)`,
      earnedCents: sql<string>`coalesce(sum(${orders.commissionCents}), 0)`,
      unpaidCents: sql<string>`coalesce(sum(${orders.commissionCents}) filter (where not ${orders.commissionPaid}), 0)`,
    })
    .from(affiliates)
    /*
     * The shop scope belongs in the join, not only on `affiliates`: without
     * it the hash join builds over every order of every shop before the
     * outer filter runs. Redundant in meaning — an affiliate's orders are
     * its shop's — and load-bearing in the plan, alongside
     * `orders_affiliate_idx` (0062).
     */
    .leftJoin(
      orders,
      and(eq(orders.affiliateId, affiliates.id), eq(orders.shopId, shopId)),
    )
    .where(eq(affiliates.shopId, shopId))
    .groupBy(affiliates.id)
    .orderBy(sql`coalesce(sum(${orders.commissionCents}), 0) desc`);

  return rows.map((r) => ({
    ...r.affiliate,
    orderCount: Number(r.orderCount),
    salesCents: Number(r.salesCents),
    earnedCents: Number(r.earnedCents),
    unpaidCents: Number(r.unpaidCents),
  }));
}

/** Every rail the seller has configured, enabled or not, in their own order. */
export async function getShopPaymentMethods(shopId: string) {
  return getDb().query.paymentMethods.findMany({
    where: eq(paymentMethods.shopId, shopId),
    orderBy: [asc(paymentMethods.position)],
  });
}

/**
 * Nullable on every field, deliberately.
 *
 * These arrive straight from `searchParams`, where "absent" and "cleared" are
 * `undefined` and `null` and a caller should not have to normalise one into the
 * other before asking a question. Each filter is applied only when truthy, so
 * both spellings mean the same thing: no filter.
 */
export type OrderFilters = {
  status?: string | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  /** Matched case-insensitively; coupon codes are stored uppercase. */
  couponCode?: string | null;
  /**
   * Free text over who bought and what — the question a seller actually
   * arrives with ("where is Maria's mug order"). Matched against the buyer's
   * name, their email and the headline product, case-insensitively.
   */
  search?: string | null;
};

/** The WHERE the two order reads share, so the list and its tab counts can
 *  never disagree about which orders they are talking about. */
function orderConditions(shopId: string, filters: OrderFilters) {
  /*
   * `%` and `_` are match syntax inside ILIKE, not text. A buyer named
   * "100%" must be findable by typing exactly that, so the input's own
   * wildcards are escaped before ours go on.
   */
  const term = filters.search ? likePattern(filters.search) : null;

  return and(
    eq(orders.shopId, shopId),
    ...(filters.status ? [eq(orders.status, filters.status)] : []),
    ...(filters.paymentMethod
      ? [eq(orders.paymentMethod, filters.paymentMethod)]
      : []),
    ...(filters.paymentStatus
      ? [eq(orders.paymentStatus, filters.paymentStatus)]
      : []),
    /*
     * Read from the order's snapshot rather than joined through `couponId`.
     * The snapshot is what the buyer was actually charged under, and it
     * survives the coupon being renamed or deleted — a join would quietly
     * stop finding last year's orders the day a seller tidies up their codes.
     */
    ...(filters.couponCode
      ? [eq(orders.couponCode, filters.couponCode.toUpperCase())]
      : []),
    ...(term
      ? [
          or(
            ilike(orders.customerName, term),
            ilike(orders.customerEmail, term),
            ilike(orders.productTitle, term),
          ),
        ]
      : []),
  );
}

/** A shop's orders, newest first, with the filters both panels offer. */
export async function getShopOrders(
  shopId: string,
  limit = 100,
  filters: OrderFilters = {},
) {
  return getDb().query.orders.findMany({
    where: orderConditions(shopId, filters),
    orderBy: [desc(orders.createdAt)],
    limit,
  });
}

/**
 * How many orders sit in each status, under the *other* filters.
 *
 * This is what the tabs above the list print, so it deliberately ignores
 * `filters.status`: the tabs are the status dimension, and a count that
 * narrowed by the selected tab would show every unselected tab as zero.
 * Counted in the database rather than over the returned page, because the
 * list is capped and a count over a sample is a lie with a number on it.
 */
export async function getShopOrderStatusCounts(
  shopId: string,
  filters: OrderFilters = {},
): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ status: orders.status, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(orderConditions(shopId, { ...filters, status: null }))
    .groupBy(orders.status);

  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

/** One order, provably the shop's own — the detail page's read. */
export async function getShopOrder(shopId: string, orderId: string) {
  return getDb().query.orders.findFirst({
    where: and(eq(orders.id, orderId), eq(orders.shopId, shopId)),
  });
}
