import "server-only";
import { notFound } from "next/navigation";
import {
  getCheckoutOptions,
  getPublicProducts,
  visibleNow,
  getShopByHandle,
  getShopFacets,
  type ShopFilters,
} from "@/lib/queries";
import { getPublishedPages, getStorefrontSections } from "@/lib/queries";
import { getShopT } from "@/i18n/server";
import { displayCurrency } from "@/lib/regional";
import { can } from "@sailo/core/plans";
import { isShopLive } from "@sailo/core/visibility";
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
  const row = await getShopByHandle(handle);
  // An unpublished shop is indistinguishable from one that never existed —
  // a seller taking their page down shouldn't leak that it's theirs.
  if (!row || !isShopLive(row)) notFound();

  /*
   * The currency this visit is quoted in, decided before anything is priced.
   *
   * Applied by *overwriting* `shop.currency` for this render rather than by
   * threading a second currency through thirty components. Every price on the
   * storefront is `formatMoney(cents, shop.currency, locale)` and every one of
   * those cents now comes out of `currency_prices`, so one substitution keeps
   * the number and its symbol in step by construction — where a second field
   * would be one more thing each new component could forget to read.
   *
   * The row itself is untouched. `shop.currency` in the database is still the
   * shop's own, which is what its settings say, what the seller is paid in and
   * what an unmatched visitor is quoted. Nothing writes from this object: every
   * server action re-reads the shop by id.
   */
  const display = await displayCurrency(row);
  const shop =
    display.currency === row.currency ? row : { ...row, currency: display.currency };

  const [page, facets, checkout, translations, sections, publishedPages] =
    await Promise.all([
      // Only the first batch. The rest arrives as the shopper scrolls, so a
      // catalogue with no ceiling can't decide how long this page takes.
      // Filtered for sell windows after the cached read — see `visibleNow`.
      getPublicProducts(shop.id, display.currency, row.currency, filters).then(
        (batch) => visibleNow(batch),
      ),
      getShopFacets(shop.id),
      getCheckoutOptions(shop.id, display.currency, row.currency),
      getShopT(shop.locale),
      /*
       * Spec 41's two blocks and the footer's document links. Two reads rather
       * than one because they answer different questions — the blocks want the
       * bodies, the footer wants five titles and slugs — and both are cached
       * under the same `shopTag`, so publishing a page invalidates both at once.
       */
      getStorefrontSections(shop.id),
      getPublishedPages(shop.id),
    ]);

  return {
    shop,
    currency: display.currency,
    currencyOptions: display.options,
    products: page.items,
    productTotal: page.total,
    nextOffset: page.nextOffset,
    facets,
    checkout,
    locale: translations.locale,
    dir: translations.dir,
    t: translations.t,
    layout: readLayout(shop.layout),
    about: sections.about,
    faq: sections.faq,
    /*
     * The footer lists the documents that are *documents* — terms, privacy and
     * refunds. About and FAQ are already on the page as blocks, and linking to
     * them from the footer as well would put the same words in two places.
     */
    legalLinks: publishedPages.filter((row) =>
      ["terms", "privacy", "refunds"].includes(row.kind),
    ),
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
