import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";

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
 * Wraps a per-shop read. `keyParts` must include everything the result varies
 * by — Next keys on the arguments, but a closure over a filter object would be
 * invisible to it and two different filters would share one entry.
 */
export function cachedForShop<Args extends unknown[], Result>(
  keyParts: string[],
  fn: (...args: Args) => Promise<Result>,
  // Takes only the first argument — the shop id or handle every one of these
  // is keyed by. Taking `...Args` made inference pick this signature over the
  // reader's, and a reader with an optional second parameter lost it.
  tagsFor: (subject: Args[0]) => string[],
): (...args: Args) => Promise<Result> {
  return (...args: Args): Promise<Result> =>
    unstable_cache(() => fn(...args), [...keyParts, ...args.map(stringify)], {
      tags: tagsFor(args[0]),
      // No time limit. Writes invalidate explicitly, which is both fresher and
      // cheaper than re-reading on a timer nobody asked for.
      revalidate: false,
    })();
}

function stringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
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
