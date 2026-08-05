import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { coupons } from "@/db/schema";

/** Discount codes. */

export async function getShopCoupons(shopId: string) {
  return getDb().query.coupons.findMany({
    where: eq(coupons.shopId, shopId),
    orderBy: [desc(coupons.createdAt)],
  });
}

/* -------------------------------------------------------------------------- */
/*  Affiliates                                                                 */
/* -------------------------------------------------------------------------- */
