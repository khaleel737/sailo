import type { Shop } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import type {
  CheckoutOptions,
  ProductCard,
  ShopFacets,
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
  /**
   * Every product matching the filter, not just the batch in `products` —
   * the filter bar counts matches, not what has loaded so far.
   */
  productTotal: number;
  /** Where the next batch starts, or null when the first batch is the whole shop. */
  nextOffset: number | null;
  /** True when the visitor narrowed the list, so "nothing found" can say why. */
  hasFilters: boolean;
};

export type ShopLayout = "grid" | "list";
