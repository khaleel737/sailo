import type { Shop, ShopPage, Testimonial } from "@sailo/db/schema";
import type { Dictionary } from "@sailo/i18n";
import type { Locale } from "@sailo/i18n/config";
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
  /**
   * The shop, with `currency` set to what **this visit** is quoted in.
   *
   * Spec 53. It is the row's own currency for every shop that has not enabled
   * a second one, which is every shop the day this ships. `currency` below is
   * the same value said out loud, for the two places that need to know which
   * one they are looking at rather than merely how to format a number.
   */
  shop: Shop;
  /** What this visit is quoted in. */
  currency: string;
  /** What the switcher may offer, the shop's own first. One entry means no switcher. */
  currencyOptions: string[];
  products: ProductCard[];
  facets: ShopFacets;
  checkout: CheckoutOptions;

  locale: Locale;
  dir: "ltr" | "rtl";
  t: Dictionary;

  /** Grid or list, as the seller chose. */
  layout: ShopLayout;
  /**
   * Approved testimonials — spec 35, read once for two surfaces.
   *
   * The strip under the products renders all of them; the basket takes the
   * first three. One list rather than two reads, because the checkout must not
   * gain a fetch.
   */
  testimonials: Testimonial[];
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

  /*
   * Spec 41. All three are null or empty for a shop that has published nothing,
   * which is every shop the day this ships — so the storefront renders exactly
   * as it did until a seller writes something.
   */
  /** The About block, when the seller has published one. */
  about: ShopPage | null;
  /** The FAQ accordion's source document, when published. */
  faq: ShopPage | null;
  /** Published terms/privacy/refunds, for the footer. */
  legalLinks: ShopPage[];
};

export type ShopLayout = "grid" | "list";
