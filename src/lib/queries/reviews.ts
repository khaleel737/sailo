import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { products, reviews } from "@/db/schema";

/** Reviews awaiting approval, and those already published. */

export async function getShopReviews(shopId: string) {
  const db = getDb();
  const rows = await db.query.reviews.findMany({
    where: eq(reviews.shopId, shopId),
    orderBy: [desc(reviews.createdAt)],
    limit: 200,
  });

  const ids = [...new Set(rows.map((r) => r.productId))];
  const titles = new Map<string, string>();
  if (ids.length) {
    const prods = await db
      .select({ id: products.id, title: products.title })
      .from(products)
      .where(inArray(products.id, ids));
    for (const p of prods) titles.set(p.id, p.title);
  }

  return rows.map((r) => ({ ...r, productTitle: titles.get(r.productId) ?? "Deleted product" }));
}

/* -------------------------------------------------------------------------- */
/*  Cached storefront reads                                                    */
/*                                                                             */
/*  A catalogue changes when its seller changes it, so these are cached until  */
/*  a write says otherwise rather than for a guessed number of seconds. See    */
/*  lib/cache.ts — every admin write path calls `revalidateShop`.              */
/* -------------------------------------------------------------------------- */
