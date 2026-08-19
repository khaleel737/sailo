"use server";

import type { ReactNode } from "react";
import {
  getPublicProducts,
  visibleNow,
  getShopByHandle,
  type ShopFilters,
  pickFilters,
} from "@/lib/queries";
import { getShopT } from "@/i18n/server";
import { displayCurrency } from "@/lib/regional";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { isShopLive } from "@sailo/core/visibility";
import { ProductCard } from "../_components/product-card";

/**
 * The next batch of the grid, rendered on the server.
 *
 * It returns nodes rather than JSON on purpose. `ProductCard` is a server
 * component, and the row behind it carries `Date` columns that JSON would
 * silently turn into strings — a type that lies at exactly the boundary where
 * nobody would look. Rendering here means the card is built the same way for
 * batch one and batch forty, so the two can't drift.
 *
 * Everything except the shop, the filter and the offset is read server-side.
 * The client has no reason to hold the price list or the delivery options, and
 * anything it sent would have to be distrusted and re-read anyway.
 */
export async function loadMoreProducts(
  handle: string,
  filters: ShopFilters,
  offset: number,
): Promise<{ nodes: ReactNode; nextOffset: number | null }> {
  const empty = { nodes: null, nextOffset: null };

  /*
   * The ceiling every other public entry point already has.
   *
   * This is a server action reached from a `"use client"` grid, so its id is
   * in the public bundle and no discovery step stands in front of it — and it
   * drives `?q=`, which is matched with a leading wildcard against two columns
   * and so cannot use an index. It was the only public action in the repo with
   * no limit, while `previewOrder` beside it has 120 a minute. This matches it.
   */
  const gate = await rateLimit(`grid:${await callerIp()}`, 120, 60);
  if (!gate.allowed) return empty;

  // A negative or fractional offset would page backwards through the
  // catalogue or land between two products.
  if (!Number.isSafeInteger(offset) || offset < 0) return empty;

  const shop = await getShopByHandle(handle);
  // The same check the page makes. A shop taken off the air must not keep
  // serving its catalogue through the action that renders it.
  if (!shop || !isShopLive(shop)) return empty;

  /*
   * The same currency the first batch was rendered in — spec 53.
   *
   * Re-derived rather than sent from the browser, for the reason the comment
   * above already gives about the price list: this is a public action and
   * anything the client sent would have to be distrusted and re-read anyway. A
   * currency taken from the request would let a hand-rolled call render batch
   * two in euros under a dollar heading.
   */
  const display = await displayCurrency(shop);
  const [page, { t, locale }] = await Promise.all([
    // The same sell-window filter the first batch got, for the same reason:
    // the cached read never expires on a clock, so the decision is taken here.
    getPublicProducts(
      shop.id,
      display.currency,
      shop.currency,
      pickFilters(filters),
      offset,
    ).then((batch) => visibleNow(batch)),
    getShopT(shop.locale),
  ]);

  const shown =
    display.currency === shop.currency ? shop : { ...shop, currency: display.currency };

  const layout = shop.layout === "list" ? "list" : "grid";

  return {
    nodes: page.items.map((product) => (
      <ProductCard
        key={product.id}
        product={product}
        shop={shown}
        layout={layout}
        t={t}
        locale={locale}
      />
    )),
    nextOffset: page.nextOffset,
  };
}
