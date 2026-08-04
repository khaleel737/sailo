import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Store } from "lucide-react";
import {
  getCheckoutMethods,
  getProductBySlug,
  getShopByHandle,
} from "@/lib/queries";
import { ProductGallery } from "@/components/shop/product-gallery";
import {
  OrderButton,
  type CheckoutMethod,
} from "@/components/shop/order-sheet";
import { ReviewForm } from "@/components/shop/review-form";
import { StarRating } from "@/components/shop/star-rating";
import { VisitTracker } from "@/components/shop/visit-tracker";
import { formatMoney, shopThemeVars } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  physical: "Physical product",
  digital: "Digital product",
  service: "Service",
};

export async function generateMetadata({
  params,
}: PageProps<"/[handle]/p/[slug]">): Promise<Metadata> {
  const { handle, slug } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop) return { title: "Not found" };

  const product = await getProductBySlug(shop.id, slug);
  if (!product) return { title: "Not found" };

  return {
    title: `${product.title} · ${shop.name}`,
    description: product.description ?? undefined,
    openGraph: {
      title: product.title,
      description: product.description ?? undefined,
      images: product.images[0]?.url ? [product.images[0].url] : undefined,
      type: "website",
    },
  };
}

export default async function ProductPage({
  params,
}: PageProps<"/[handle]/p/[slug]">) {
  const { handle, slug } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop || !shop.isPublished) notFound();

  const product = await getProductBySlug(shop.id, slug);
  if (!product || !product.isPublished) notFound();

  const checkoutMethods = await getCheckoutMethods(shop.id);
  const methods: CheckoutMethod[] = checkoutMethods.map((m) => ({
    type: m.type as CheckoutMethod["type"],
    label: m.label,
  }));

  const onSale =
    product.compareAtCents !== null &&
    product.compareAtCents > product.priceCents;

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
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
              {KIND_LABEL[product.kind] ?? product.kind}
            </span>
            {!product.inStock ? (
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                Sold out
              </span>
            ) : null}
          </div>

          <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight">
            {product.title}
          </h1>

          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-semibold tabular-nums">
              {product.priceCents > 0
                ? formatMoney(product.priceCents, shop.currency)
                : "Free"}
            </span>
            {onSale ? (
              <span className="text-muted text-sm line-through tabular-nums">
                {formatMoney(product.compareAtCents!, shop.currency)}
              </span>
            ) : null}
          </div>

          {product.reviewCount > 0 ? (
            <StarRating
              value={product.avgRating}
              count={product.reviewCount}
              size="md"
              className="mt-2"
            />
          ) : null}

          {product.description ? (
            <p className="text-muted mt-4 whitespace-pre-wrap text-sm leading-relaxed">
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
              methods={methods}
              needsAddress={shop.collectAddress && product.kind === "physical"}
              contactEmail={shop.contactEmail}
              inStock={product.inStock}
            />
          </div>
        </div>

        <section className="mt-12">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold">
              Reviews{" "}
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
                      {review.createdAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </time>
                  </div>
                  <StarRating value={review.rating} className="mt-1.5" />
                  {review.body ? (
                    <p className="mt-2 text-sm leading-relaxed">{review.body}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted mb-5 text-sm">
              No reviews yet — be the first.
            </p>
          )}

          <ReviewForm productId={product.id} />
        </section>

        <footer className="mt-14 text-center">
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
