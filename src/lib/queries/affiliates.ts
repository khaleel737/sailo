import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { affiliates, orders, type Affiliate } from "@/db/schema";

/** The referral programme: who promotes a shop and what they have earned. */

export type AffiliateRow = Affiliate & {
  orderCount: number;
  salesCents: number;
  earnedCents: number;
  unpaidCents: number;
};

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

export async function getAffiliateByCode(shopId: string, code: string) {
  return getDb().query.affiliates.findFirst({
    where: and(
      eq(affiliates.shopId, shopId),
      eq(affiliates.code, code.toUpperCase()),
      eq(affiliates.status, "active"),
    ),
  });
}

/* -------------------------------------------------------------------------- */
/*  Invoices                                                                   */
/* -------------------------------------------------------------------------- */
