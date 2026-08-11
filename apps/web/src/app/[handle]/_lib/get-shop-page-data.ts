import "server-only";
import { notFound } from "next/navigation";
import {
  getCheckoutOptions,
  getPublicProducts,
  getShopByHandle,
  getShopFacets,
  type ShopFilters,
} from "@/lib/queries";
import { getShopT } from "@/i18n/server";
import { can } from "@/lib/plans";
import { isShopLive } from "@/lib/utils";
import type { ShopLayout, ShopPageData } from "../_types/shop-page.types";

/**
 * Resolves everything the storefront renders.
 *
 * The page had this inline: five awaits, four derived booleans and a `notFound`
 * mixed into the markup. Pulling it here means the page is a page, this is
 * testable without a browser, and the product page and the affiliate page can
 * ask the same questions the same way.
 */
export async function getShopPageData(
  handle: string,
  filters: ShopFilters,
): Promise<ShopPageData> {
  const shop = await getShopByHandle(handle);
  // An unpublished shop is indistinguishable from one that never existed —
  // a seller taking their page down shouldn't leak that it's theirs.
  if (!shop || !isShopLive(shop)) notFound();

  const [page, facets, checkout, translations] = await Promise.all([
    // Only the first batch. The rest arrives as the shopper scrolls, so a
    // catalogue with no ceiling can't decide how long this page takes.
    getPublicProducts(shop.id, shop.currency, filters),
    getShopFacets(shop.id),
    getCheckoutOptions(shop.id),
    getShopT(shop.locale),
  ]);

  return {
    shop,
    products: page.items,
    productTotal: page.total,
    nextOffset: page.nextOffset,
    facets,
    checkout,
    locale: translations.locale,
    dir: translations.dir,
    t: translations.t,
    layout: readLayout(shop.layout),
    // A downgrade has to switch the programme off publicly, not just in admin.
    affiliatesLive: shop.affiliatesEnabled && can(shop, "affiliates"),
    hasFilters: hasActiveFilters(filters),
  };
}

/** Anything but "list" is the grid — an unknown value shouldn't blank the page. */
function readLayout(value: string): ShopLayout {
  return value === "list" ? "list" : "grid";
}

/**
 * Whether the visitor narrowed the list, so an empty result can say why.
 * `sort` is deliberately excluded: sorting never removes anything, so an empty
 * page after sorting means the shop is empty, not that a filter was too tight.
 */
export function hasActiveFilters(filters: ShopFilters): boolean {
  return Boolean(
    filters.q ||
      filters.category ||
      filters.kind ||
      filters.min ||
      filters.max ||
      filters.inStock,
  );
}
