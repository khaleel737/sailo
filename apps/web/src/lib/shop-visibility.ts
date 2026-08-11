import { and, eq, isNull, type SQL } from "drizzle-orm";
import { shops } from "@/db/schema";

/**
 * `isShopLive`, as a WHERE clause.
 *
 * The same three switches — the seller's `isPublished`, our `suspendedAt`,
 * and deletion's `deletedAt` — but for the paths that decide in SQL rather
 * than on a row already read. Those had the pair written out by hand at six
 * call sites, which is exactly the shape the comment on `isShopLive` warns
 * about: adding a third switch meant finding all six, and the seventh route
 * written next month would have honoured two of three.
 */
export function liveShop(...extra: (SQL | undefined)[]): SQL | undefined {
  return and(
    eq(shops.isPublished, true),
    isNull(shops.suspendedAt),
    isNull(shops.deletedAt),
    ...extra,
  );
}
