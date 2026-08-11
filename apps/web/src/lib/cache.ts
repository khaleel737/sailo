import "server-only";
import { revalidateTag, updateTag } from "next/cache";

/**
 * Storefront caching.
 *
 * A shop's catalogue is read constantly and written rarely — a seller edits a
 * product a few times a week, and every visitor between those edits gets the
 * same answer. Yet each page view issues around nine queries, and with a
 * serverless driver every one of them is an HTTP round trip. That's where a
 * storefront page's time actually goes; the queries themselves measured under
 * a tenth of a millisecond at 5,000 shops.
 *
 * So the catalogue is cached per shop and invalidated by tag the moment
 * anything about that shop changes. Not by time: a seller who fixes a typo
 * should see it immediately, not in five minutes.
 *
 * The caching itself now lives at each reader as `"use cache"` — this module
 * is just the tag vocabulary and the invalidation both sides agree on. The
 * `cachedForShop` wrapper that used to sit here is gone: `unstable_cache`
 * needed a hand-written key, and a hand-written key is a thing that can
 * silently omit an argument and serve two shops one answer.
 *
 * Cookies and headers must never be read inside a cached scope — the locale a
 * visitor chose isn't part of the catalogue, so it stays outside and the
 * translated strings are applied after.
 */

/** Everything about one shop's storefront: its row, catalogue and checkout options. */
export function shopTag(shopId: string) {
  return `shop:${shopId}`;
}

/** The handle → shop lookup, which survives edits to the shop's contents. */
export function handleTag(handle: string) {
  return `handle:${handle.toLowerCase()}`;
}


/**
 * Called from every write path that changes what a storefront renders.
 *
 * Deliberately one function rather than a tag per table: a seller editing a
 * product, a variant, a category and a delivery rate is one mental act, and
 * remembering which of four tags to bump is exactly the sort of thing that
 * gets forgotten and ships a stale shop.
 */
export function revalidateShop(shopId: string, handle?: string) {
  revalidateTag(shopTag(shopId), "max");
  if (handle) revalidateTag(handleTag(handle), "max");
}

/**
 * The same invalidation, but the next reader waits for fresh data instead of
 * being handed the stale copy while it refreshes behind them.
 *
 * `revalidateTag(…, "max")` above is stale-while-revalidate, which is the right
 * trade for a seller fixing a typo: one visitor sees the old price for one more
 * request and nobody is harmed. It is the wrong trade when we take a shop off
 * the air from /hq — "suspended" has to mean suspended on the very next
 * request, not the one after it, and a measured test caught exactly that: a
 * suspended storefront still answered 200 once before going dark.
 *
 * Server Actions only; `updateTag` throws anywhere else.
 */
export function updateShopNow(shopId: string, handle?: string) {
  updateTag(shopTag(shopId));
  if (handle) updateTag(handleTag(handle));
}
