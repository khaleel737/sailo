import "server-only";
import { and, eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { getDb } from "@sailo/db";
import { products, shops } from "@sailo/db/schema";
import { liveShop } from "@/lib/shop-visibility";
import { shopTag } from "@/lib/cache";

/**
 * The beacon's two questions, answered once per shop per cache window: is
 * this shop reachable, and does the product the beacon names belong to it.
 *
 * `/api/track` is the hottest endpoint in the app, and its validation read
 * was most of what a pageview cost the primary — a query per beacon whose
 * answer changes only when the seller publishes, unpublishes or is
 * suspended. Cached under the same `shopTag` the storefront pages already
 * live behind, so the beacon's view of "live" can never outlast the page a
 * visitor is actually looking at: `liveShop` is flags only (`isPublished`,
 * `suspendedAt`, `deletedAt`), and every write to those calls
 * `revalidateShop`. `cacheLife("minutes")` is belt and braces on top — a
 * beacon miscounted for a minute is a rounding error, not a bug.
 */
export async function beaconTarget(
  shopId: string,
  productId: string | null,
): Promise<{ live: boolean; productId: string | null }> {
  "use cache";
  cacheLife("minutes");
  cacheTag(shopTag(shopId));

  const db = getDb();
  if (productId) {
    /*
     * One round trip for both questions. A product that is not this shop's
     * comes back null and is ignored rather than refused — the shop's own
     * visit is still worth counting.
     */
    const [row] = await db
      .select({ productId: products.id })
      .from(shops)
      .leftJoin(
        products,
        and(eq(products.id, productId), eq(products.shopId, shops.id)),
      )
      .where(liveShop(eq(shops.id, shopId)))
      .limit(1);
    return row
      ? { live: true, productId: row.productId ?? null }
      : { live: false, productId: null };
  }

  const shop = await db.query.shops.findFirst({
    where: liveShop(eq(shops.id, shopId)),
    columns: { id: true },
  });
  return { live: Boolean(shop), productId: null };
}
