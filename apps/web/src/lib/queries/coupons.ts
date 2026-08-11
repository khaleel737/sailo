import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { coupons } from "@sailo/db/schema";

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
