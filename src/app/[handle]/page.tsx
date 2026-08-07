import type { Metadata } from "next";
import { Suspense } from "react";
import { getShopByHandle, type ShopFilters } from "@/lib/queries";
import { absolute, shopJsonLd } from "@/lib/seo";
import { shopThemeVars } from "@/lib/utils";
import { getShopPageData } from "./_lib/get-shop-page-data";
import { CartRegion } from "./_components/cart/cart-region";
import { FilterBar } from "./_components/filter-bar";
import { ProductGrid } from "./_components/product-grid";
import { ReferralCapture } from "./_components/referral-capture";
import { ShopFooter } from "./_components/shop-footer";
import { ShopHeader } from "./_components/shop-header";
import { VisitTracker } from "./_components/visit-tracker";

export async function generateMetadata({
  params,
}: PageProps<"/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop) return { title: "Shop not found" };

  const description = shop.description ?? `Shop ${shop.name} on Sailo.`;
  const url = absolute(`/${shop.handle}`);

  return {
    /*
     * `absolute` so the root layout's "%s · Sailo" template does not run.
     * A storefront is the seller's brand, and a search result reading
     * "Forno Nove · Sailo" spends the seller's title on our name.
     */
    title: { absolute: shop.name },
    description,
    /*
     * The filter bar puts its state in the query string, so `?category=mugs`
     * and `?sort=newest` are the same catalogue seen through two windows.
     * Pointing every one of them at the bare handle keeps a shop from
     * competing with itself for its own name.
     */
    alternates: { canonical: url },
    openGraph: {
      title: shop.name,
      description,
      url,
      siteName: shop.name,
      type: "website",
      /*
       * No `images` here on purpose. `opengraph-image.tsx` in this segment
       * draws a proper 1200x630 card and Next wires it up with its own size
       * and alt tags. Listing the avatar as well would put a 400px square
       * first in the list, and that is the one every crawler would take.
       */
    },
    twitter: {
      card: "summary_large_image",
      title: shop.name,
      description,
    },
  };
}

export default async function ShopPage({
  params,
  searchParams,
}: PageProps<"/[handle]">) {
  const { handle } = await params;
  const filters = (await searchParams) as ShopFilters;

  const {
    shop,
    products,
    facets,
    checkout,
    locale,
    dir,
    t,
    layout,
    affiliatesLive,
    productTotal,
    nextOffset,
    hasFilters,
  } = await getShopPageData(handle, filters);

  return (
    <CartRegion
      shopId={shop.id}
      shopName={shop.name}
      currency={shop.currency}
      theme={shop.theme}
      accentColor={shop.accentColor}
      dir={dir}
      locale={locale}
      methods={checkout.methods}
      deliveryOptions={checkout.deliveryOptions}
      contactEmail={shop.contactEmail}
      t={t}
    >
      <div
        data-surface={shop.theme === "dark" ? "dark" : "light"}
        dir={dir}
        lang={locale}
        style={shopThemeVars(shop.accentColor)}
        className="min-h-screen"
      >
        {/* A storefront is a shop, so say so — the name, address and image a
          crawler needs are already on the page.

          The rails come from the same `checkout` object the order sheet
          renders from, so what the markup claims a buyer can pay with and
          what the buttons actually offer are the same list, and neither costs
          a query the page was not already making. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            shopJsonLd(shop, {
              payment: checkout.methods,
              delivery: checkout.deliveryOptions,
            }),
          ),
        }}
      />
      <VisitTracker shopId={shop.id} />
        {affiliatesLive ? (
          // Reads `?ref=` from the URL, so it needs a search-params boundary.
          <Suspense fallback={null}>
            <ReferralCapture shopId={shop.id} />
          </Suspense>
        ) : null}

        <div className="mx-auto w-full max-w-[680px] px-4 pb-20 pt-12 sm:pt-16">
          <ShopHeader shop={shop} />

          <div className="mt-10">
            <FilterBar
              facets={facets}
              resultCount={productTotal}
              currency={shop.currency}
              t={t}
            />
          </div>

          <main className="mt-5">
            <ProductGrid
              // Changing a filter starts a new catalogue, so the batches
              // loaded for the old one have to go with it. Without the key the
              // client keeps them and appends the new shop underneath.
              key={JSON.stringify(filters)}
              products={products}
              shop={shop}
              layout={layout}
              checkout={checkout}
              hasFilters={hasFilters}
              filters={filters}
              nextOffset={nextOffset}
              t={t}
              locale={locale}
            />
          </main>

          <ShopFooter
            shop={shop}
            affiliatesLive={affiliatesLive}
            locale={locale}
            t={t}
          />
        </div>
      </div>
    </CartRegion>
  );
}
