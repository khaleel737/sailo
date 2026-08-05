import type { Shop } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import type {
  CheckoutOptions,
  ProductCard,
  ShopFacets,
  ShopFilters,
} from "@/lib/queries";

/**
 * Everything the storefront needs to render, resolved once.
 *
 * The page reads this and does no fetching of its own. Keeping the shape named
 * means the loader and the page can't drift: adding a field to one without the
 * other is a compile error rather than a blank section.
 */
export type ShopPageData = {
  shop: Shop;
  products: ProductCard[];
  facets: ShopFacets;
  checkout: CheckoutOptions;

  locale: Locale;
  dir: "ltr" | "rtl";
  t: Dictionary;

  /** Grid or list, as the seller chose. */
  layout: ShopLayout;
  /**
   * Whether the referral programme is actually live. A downgrade has to switch
   * it off publicly, not just hide it in admin.
   */
  affiliatesLive: boolean;
  /** Free plans carry the Sailo badge. */
  showBadge: boolean;
  /** True when the visitor narrowed the list, so "nothing found" can say why. */
  hasFilters: boolean;
};

export type ShopLayout = "grid" | "list";

export type ShopPageParams = {
  handle: string;
  filters: ShopFilters;
};
