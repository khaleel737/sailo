import Image from "next/image";
import Link from "next/link";
import { ImageIcon } from "lucide-react";
import type { ProductCard as ProductCardData } from "@/lib/queries";
import type { Shop } from "@/db/schema";
import { cn, formatMoney } from "@/lib/utils";
import { StarRating } from "./star-rating";
import { OrderButton } from "./order-sheet";

const KIND_LABEL: Record<string, string> = {
  digital: "Digital",
  service: "Service",
};

export function ProductCard({
  product,
  shop,
  layout,
}: {
  product: ProductCardData;
  shop: Shop;
  layout: "grid" | "list";
}) {
  const href = `/${shop.handle}/p/${product.slug}`;
  const image = product.images[0];
  const onSale =
    product.compareAtCents !== null &&
    product.compareAtCents > product.priceCents;
  const kindLabel = KIND_LABEL[product.kind];

  return (
    <article
      className={cn(
        "surface-card group overflow-hidden rounded-2xl transition hover:shadow-md",
        layout === "list" && "flex gap-4 p-3",
      )}
    >
      <Link
        href={href}
        className={cn(
          "relative block overflow-hidden bg-black/5",
          layout === "grid"
            ? "aspect-square w-full"
            : "size-24 shrink-0 rounded-xl sm:size-28",
        )}
      >
        {image ? (
          <Image
            src={image.url}
            alt={image.alt ?? product.title}
            fill
            sizes={layout === "grid" ? "(max-width: 640px) 50vw, 320px" : "112px"}
            className="object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="text-muted flex size-full items-center justify-center">
            <ImageIcon className="size-7 opacity-40" />
          </div>
        )}

        {!product.inStock ? (
          <span className="absolute left-2 top-2 rounded-full bg-black/75 px-2 py-0.5 text-[11px] font-medium text-white">
            Sold out
          </span>
        ) : onSale ? (
          <span className="absolute left-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
            Sale
          </span>
        ) : null}
      </Link>

      <div
        className={cn(
          "flex flex-1 flex-col",
          layout === "grid" ? "p-3" : "min-w-0 py-0.5",
        )}
      >
        <div className="flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link href={href} className="min-w-0">
              <h3 className="truncate text-sm font-semibold leading-snug">
                {product.title}
              </h3>
            </Link>
            {kindLabel ? (
              <span className="surface-elevated text-muted shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                {kindLabel}
              </span>
            ) : null}
          </div>

          {layout === "list" && product.description ? (
            <p className="text-muted mt-1 line-clamp-2 text-xs">
              {product.description}
            </p>
          ) : null}

          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tabular-nums">
              {product.priceCents > 0
                ? formatMoney(product.priceCents, shop.currency)
                : "Free"}
            </span>
            {onSale ? (
              <span className="text-muted text-xs line-through tabular-nums">
                {formatMoney(product.compareAtCents!, shop.currency)}
              </span>
            ) : null}
          </div>

          {product.reviewCount > 0 ? (
            <StarRating
              value={product.avgRating}
              count={product.reviewCount}
              className="mt-1.5"
            />
          ) : null}
        </div>

        <div className="mt-3">
          <OrderButton
            shopId={shop.id}
            shopName={shop.name}
            productId={product.id}
            productTitle={product.title}
            priceCents={product.priceCents}
            currency={shop.currency}
            hasWhatsApp={Boolean(shop.whatsapp)}
            contactEmail={shop.contactEmail}
            inStock={product.inStock}
            label="Order"
            className="accent-bg h-9 w-full rounded-lg text-xs font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
      </div>
    </article>
  );
}
