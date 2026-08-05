import type { Metadata } from "next";
import { Suspense } from "react";
import { getShopByHandle, type ShopFilters } from "@/lib/queries";
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

  return {
    title: shop.name,
    description: shop.description ?? `Shop ${shop.name} on Sailo.`,
    openGraph: {
      title: shop.name,
      description: shop.description ?? undefined,
      images: shop.avatarUrl ? [shop.avatarUrl] : undefined,
      type: "website",
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
    showBadge,
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
              resultCount={products.length}
              currency={shop.currency}
              t={t}
            />
          </div>

          <main className="mt-5">
            <ProductGrid
              products={products}
              shop={shop}
              layout={layout}
              checkout={checkout}
              hasFilters={hasFilters}
              t={t}
            />
          </main>

          <ShopFooter
            shop={shop}
            affiliatesLive={affiliatesLive}
            showBadge={showBadge}
            locale={locale}
            t={t}
          />
        </div>
      </div>
    </CartRegion>
  );
}
