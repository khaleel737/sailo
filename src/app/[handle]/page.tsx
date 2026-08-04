import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gift, MapPin, PackageOpen, Store } from "lucide-react";
import { formatPercent } from "@/lib/pricing";
import { Suspense } from "react";
import {
  getCheckoutOptions,
  getPublicProducts,
  getShopByHandle,
  getShopCategories,
  type ShopFilters,
} from "@/lib/queries";
import { FilterBar } from "@/components/shop/filter-bar";
import { ProductCard } from "@/components/shop/product-card";
import { ReferralCapture } from "@/components/shop/referral-capture";
import { SocialIcons } from "@/components/shop/social-icons";
import { VisitTracker } from "@/components/shop/visit-tracker";
import { cn, shopThemeVars } from "@/lib/utils";

export async function generateMetadata({
  params,
}: PageProps<"/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop) return { title: "Shop not found" };

  return {
    title: shop.name,
    description: shop.description ?? `Shop ${shop.name} on Shopik.`,
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
  const shop = await getShopByHandle(handle);
  if (!shop || !shop.isPublished) notFound();

  const filters = (await searchParams) as ShopFilters;
  const [categories, products, checkout] = await Promise.all([
    getShopCategories(shop.id),
    getPublicProducts(shop.id, filters),
    getCheckoutOptions(shop.id),
  ]);

  const layout = shop.layout === "list" ? "list" : "grid";
  const hasFilters = Boolean(
    filters.q || filters.category || filters.kind || filters.min || filters.max,
  );

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
      style={shopThemeVars(shop.accentColor)}
      className="min-h-screen"
    >
      <VisitTracker shopId={shop.id} />
      {shop.affiliatesEnabled ? (
        <Suspense fallback={null}>
          <ReferralCapture shopId={shop.id} />
        </Suspense>
      ) : null}

      <div className="mx-auto w-full max-w-[680px] px-4 pb-20 pt-12 sm:pt-16">
        <header className="flex flex-col items-center text-center">
          {shop.avatarUrl ? (
            <Image
              src={shop.avatarUrl}
              alt={shop.name}
              width={96}
              height={96}
              className="size-24 rounded-full object-cover"
              priority
            />
          ) : (
            <div className="accent-bg flex size-24 items-center justify-center rounded-full">
              <Store className="size-9" />
            </div>
          )}

          {shop.logoUrl ? (
            <Image
              src={shop.logoUrl}
              alt={`${shop.name} logo`}
              width={160}
              height={40}
              className="mt-4 h-8 w-auto object-contain"
            />
          ) : (
            <h1 className="mt-4 text-xl font-bold tracking-tight sm:text-2xl">
              {shop.name}
            </h1>
          )}

          {shop.description ? (
            <p className="text-muted mt-2 max-w-md text-sm leading-relaxed">
              {shop.description}
            </p>
          ) : null}

          {shop.location ? (
            <p className="text-muted mt-2 inline-flex items-center gap-1 text-xs">
              <MapPin className="size-3.5" />
              {shop.location}
            </p>
          ) : null}

          <div className="mt-5">
            <SocialIcons socials={shop.socials} />
          </div>
        </header>

        <div className="mt-10">
          <FilterBar
            categories={categories}
            resultCount={products.length}
            currency={shop.currency}
          />
        </div>

        <main className="mt-5">
          {products.length === 0 ? (
            <div className="surface-card flex flex-col items-center rounded-2xl px-6 py-16 text-center">
              <PackageOpen className="text-muted mb-3 size-8 opacity-50" />
              <p className="font-medium">
                {hasFilters ? "Nothing matches that" : "No products yet"}
              </p>
              <p className="text-muted mt-1 text-sm">
                {hasFilters
                  ? "Try clearing a filter or searching for something else."
                  : `${shop.name} hasn't added anything yet. Check back soon.`}
              </p>
            </div>
          ) : (
            <div
              className={cn(
                layout === "grid"
                  ? "grid grid-cols-2 gap-3 sm:gap-4"
                  : "flex flex-col gap-3",
              )}
            >
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  shop={shop}
                  layout={layout}
                  methods={checkout.methods}
                  deliveryOptions={checkout.deliveryOptions}
                />
              ))}
            </div>
          )}
        </main>

        <footer className="mt-14 flex flex-col items-center gap-3 text-center">
          {shop.affiliatesEnabled ? (
            <Link
              href={`/${shop.handle}/affiliate`}
              className="surface-card inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition hover:opacity-70"
            >
              <Gift className="size-3.5" />
              Earn {formatPercent(shop.affiliateDefaultBp)}% by sharing this shop
            </Link>
          ) : null}
          <Link
            href="/"
            className="text-muted inline-flex items-center gap-1.5 text-xs transition hover:opacity-70"
          >
            <Store className="size-3.5" />
            Powered by <span className="font-semibold">Shopik</span>
          </Link>
        </footer>
      </div>
    </div>
  );
}
