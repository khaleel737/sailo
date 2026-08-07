"use server";

import type { ReactNode } from "react";
import {
  getCheckoutOptions,
  getPublicProducts,
  getShopByHandle,
  type ShopFilters,
} from "@/lib/queries";
import { getShopT } from "@/i18n/server";
import { isShopLive } from "@/lib/utils";
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

  // A negative or fractional offset would page backwards through the
  // catalogue or land between two products.
  if (!Number.isSafeInteger(offset) || offset < 0) return empty;

  const shop = await getShopByHandle(handle);
  // The same check the page makes. A shop taken off the air must not keep
  // serving its catalogue through the action that renders it.
  if (!shop || !isShopLive(shop)) return empty;

  const [page, checkout, { t, locale }] = await Promise.all([
    getPublicProducts(shop.id, shop.currency, filters, offset),
    getCheckoutOptions(shop.id),
    getShopT(shop.locale),
  ]);

  const layout = shop.layout === "list" ? "list" : "grid";

  return {
    nodes: page.items.map((product) => (
      <ProductCard
        key={product.id}
        product={product}
        shop={shop}
        layout={layout}
        methods={checkout.methods}
        deliveryOptions={checkout.deliveryOptions}
        t={t}
        locale={locale}
      />
    )),
    nextOffset: page.nextOffset,
  };
}
