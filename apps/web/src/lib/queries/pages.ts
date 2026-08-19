import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { ShopPage } from "@sailo/db/schema";
import {
  publishedPageBySlug,
  publishedPagesFor,
  storefrontSectionsFor,
} from "@sailo/commerce/pages";
import { shopTag } from "@/lib/cache";

/**
 * The seller's hosted documents, read the way a storefront reads them.
 *
 * The uncached reads are `@sailo/commerce/pages` — the admin and the checkout's
 * policy snapshotter both want what is true *now*. These three are the public
 * side, and they carry `shopTag` so that publishing a page from the admin makes
 * it appear on the next request rather than whenever a timer says so.
 *
 * Same split as `getShopFacets` and its siblings, and for the same reason the
 * `shop-views` package states: the caching is the point of these, and it does
 * not travel outside this app.
 */

/** Every published page for the footer links. */
export async function getPublishedPages(shopId: string): Promise<ShopPage[]> {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return publishedPagesFor(shopId);
}

/** One published page, for `/[handle]/legal/[slug]`. */
export async function getPublishedPage(
  shopId: string,
  slug: string,
): Promise<ShopPage | null> {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return publishedPageBySlug(shopId, slug);
}

/** The About block and the FAQ accordion, in one pass. */
export async function getStorefrontSections(shopId: string) {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return storefrontSectionsFor(shopId);
}
