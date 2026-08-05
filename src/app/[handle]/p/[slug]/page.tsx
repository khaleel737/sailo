import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getCheckoutOptions,
  getProductBySlug,
  getShopByHandle,
} from "@/lib/queries";
import { ProductGallery } from "@/app/[handle]/p/[slug]/_components/product-gallery";
import { OrderButton } from "@/app/[handle]/_components/cart/order-sheet";
import { CartRegion } from "@/app/[handle]/_components/cart/cart-region";
import { ReviewForm } from "@/app/[handle]/p/[slug]/_components/review-form";
import { StarRating } from "@/app/[handle]/_components/star-rating";
import { VisitTracker } from "@/app/[handle]/_components/visit-tracker";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@/i18n";
import {
  formatDuration,
  formatMoney,
  isShopLive,
  shopThemeVars,
} from "@/lib/utils";
import {
  anySellable,
  isLowStock,
  priceRange,
  toCheckoutVariants,
  unitsLeft,
} from "@/lib/variants";
import { PoweredBy } from "@/components/shared/powered-by";
import { absolute } from "@/lib/seo";

export async function generateMetadata({
  params,
}: PageProps<"/[handle]/p/[slug]">): Promise<Metadata> {
  const { handle, slug } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop) return { title: "Not found" };

  const product = await getProductBySlug(shop.id, slug);
  if (!product) return { title: "Not found" };

  const image = product.images[0]?.url;
  const url = absolute(`/${shop.handle}/p/${product.slug}`);

  return {
    title: `${product.title} · ${shop.name}`,
    description: product.description ?? undefined,
    alternates: { canonical: url },
    // An unpublished product is reachable by URL for the seller's own preview;
    // it must not be reachable through search.
    robots: product.isPublished ? undefined : { index: false, follow: false },
    openGraph: {
      title: product.title,
      description: product.description ?? undefined,
      url,
      siteName: shop.name,
      images: image ? [image] : undefined,
      type: "website",
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: product.title,
      description: product.description ?? undefined,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ProductPage({
  params,
}: PageProps<"/[handle]/p/[slug]">) {
  const { handle, slug } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop || !isShopLive(shop)) notFound();

  const product = await getProductBySlug(shop.id, slug);
  if (!product || !product.isPublished) notFound();

  const checkout = await getCheckoutOptions(shop.id);
  const { locale, t, dir } = await getShopT(shop.locale);
  const kindLabel =
    product.kind === "digital"
      ? t.shop.kindDigital
      : product.kind === "service"
        ? t.shop.kindService
        : t.shop.kindPhysical;

  const variants = toCheckoutVariants(product, product.variants);
  const range = priceRange(product, product.variants);
  const sellable = product.inStock && anySellable(product, product.variants);
  const stockLeft = unitsLeft(product);

  const onSale =
    !range.varies &&
    product.compareAtCents !== null &&
    product.compareAtCents > range.min;

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
      <VisitTracker shopId={shop.id} productId={product.id} />

      <div className="mx-auto w-full max-w-[680px] px-4 pb-20 pt-8">
        <Link
          href={`/${shop.handle}`}
          className="text-muted mb-6 inline-flex items-center gap-1.5 text-sm transition hover:opacity-70"
        >
          <ArrowLeft className="size-4" />
          {shop.name}
        </Link>

        <ProductGallery images={product.images} title={product.title} />

        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-2">
            {product.category ? (
              <Link
                href={`/${shop.handle}?category=${product.category.slug}`}
                className="surface-elevated text-muted rounded-full px-2.5 py-1 text-xs font-medium transition hover:opacity-70"
              >
                {product.category.name}
              </Link>
            ) : null}
            <span className="surface-elevated text-muted rounded-full px-2.5 py-1 text-xs font-medium">
              {kindLabel}
            </span>
            {product.kind === "service" && product.durationMinutes ? (
              <span className="surface-elevated text-muted rounded-full px-2.5 py-1 text-xs font-medium">
                {interpolate(t.checkout.duration, {
                  duration: formatDuration(product.durationMinutes),
                })}
              </span>
            ) : null}
            {product.kind === "service" ? (
              <span className="surface-elevated text-muted rounded-full px-2.5 py-1 text-xs font-medium">
                {product.serviceMode === "online"
                  ? t.checkout.online
                  : t.checkout.inPerson}
              </span>
            ) : null}
            {!sellable ? (
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                {t.shop.soldOut}
              </span>
            ) : null}
          </div>

          <h1
            dir="auto"
            className="mt-3 text-2xl font-bold leading-tight tracking-tight"
          >
            {product.title}
          </h1>

          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-semibold tabular-nums">
              {range.min > 0
                ? range.varies
                  ? interpolate(t.shop.from, {
                      price: formatMoney(range.min, shop.currency),
                    })
                  : formatMoney(range.min, shop.currency)
                : t.common.free}
            </span>
            {onSale ? (
              <span className="text-muted text-sm line-through tabular-nums">
                {formatMoney(product.compareAtCents!, shop.currency)}
              </span>
            ) : null}
          </div>

          {sellable && isLowStock(stockLeft) ? (
            <p className="mt-1.5 text-sm font-medium text-amber-600">
              {interpolate(t.checkout.onlyLeft, { count: stockLeft })}
            </p>
          ) : null}

          {product.options.length > 0 ? (
            <dl className="mt-3 space-y-1">
              {product.options.map((option) => (
                <div key={option.name} className="flex gap-2 text-sm">
                  <dt className="text-muted">{option.name}:</dt>
                  <dd>{option.values.join(" · ")}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {product.reviewCount > 0 ? (
            <StarRating
              value={product.avgRating}
              count={product.reviewCount}
              size="md"
              className="mt-2"
              t={t}
            />
          ) : null}

          {product.description ? (
            <p
              dir="auto"
              className="text-muted mt-4 whitespace-pre-wrap text-sm leading-relaxed"
            >
              {product.description}
            </p>
          ) : null}

          {product.tags.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {product.tags.map((tag) => (
                <li
                  key={tag}
                  className="surface-elevated text-muted rounded-md px-2 py-0.5 text-xs"
                >
                  #{tag}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6">
            <OrderButton
              shopId={shop.id}
              shopName={shop.name}
              productId={product.id}
              productTitle={product.title}
              priceCents={product.priceCents}
              currency={shop.currency}
              methods={checkout.methods}
              deliveryOptions={checkout.deliveryOptions}
              kind={product.kind}
              options={product.options}
              variants={variants}
              unitsLeft={stockLeft}
              service={
                product.kind === "service"
                  ? {
                      bookingEnabled: product.bookingEnabled,
                      bookingLeadHours: product.bookingLeadHours,
                      durationMinutes: product.durationMinutes,
                      mode: product.serviceMode,
                    }
                  : null
              }
              serviceLocation={product.serviceLocation}
              imageUrl={product.images[0]?.url ?? null}
              hasFiles={product.kind === "digital" && product.files.length > 0}
              heldUntilPaid={product.releaseOnPayment}
              contactEmail={shop.contactEmail}
              inStock={product.inStock}
              t={t}
            />
          </div>
        </div>

        <section className="mt-12">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold">
              {t.product.reviews}{" "}
              {product.reviewCount > 0 ? (
                <span className="text-muted font-normal">
                  ({product.reviewCount})
                </span>
              ) : null}
            </h2>
            <StarRating
              value={product.avgRating}
              size="md"
              showEmpty
              t={t}
            />
          </div>

          {product.reviews.length > 0 ? (
            <ul className="mb-5 space-y-3">
              {product.reviews.map((review) => (
                <li key={review.id} className="surface-card rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">
                      {review.authorName}
                    </span>
                    <time
                      dateTime={review.createdAt.toISOString()}
                      className="text-muted text-xs"
                    >
                      {review.createdAt.toLocaleDateString(locale, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </time>
                  </div>
                  <StarRating value={review.rating} className="mt-1.5" t={t} />
                  {review.body ? (
                    <p className="mt-2 text-sm leading-relaxed">{review.body}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted mb-5 text-sm">
              {t.product.noReviews}
            </p>
          )}

          <ReviewForm productId={product.id} t={t} />
        </section>

        <footer className="mt-14 flex flex-col items-center gap-3 text-center">
          <PoweredBy shop={shop} t={t} />
          <LanguageSwitcher current={locale} label={t.common.language} />
        </footer>
      </div>
    </div>
    </CartRegion>
  );
}
