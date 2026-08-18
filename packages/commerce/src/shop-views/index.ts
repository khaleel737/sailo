import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
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
    .leftJoin(orders, eq(orders.affiliateId, affiliates.id))
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
};

/** A shop's orders, newest first, with the filters both panels offer. */
export async function getShopOrders(
  shopId: string,
  limit = 100,
  filters: OrderFilters = {},
) {
  return getDb().query.orders.findMany({
    where: and(
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
    ),
    orderBy: [desc(orders.createdAt)],
    limit,
  });
}
