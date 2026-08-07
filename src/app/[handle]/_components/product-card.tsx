import Image from "next/image";
import Link from "next/link";
import { ImageIcon } from "lucide-react";
import type { ProductCard as ProductCardData } from "@/lib/queries";
import type { Shop } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import { cn, formatMoney } from "@/lib/utils";
import {
  anySellable,
  priceRange,
  toCheckoutVariants,
  unitsLeft,
} from "@/lib/variants";
import { interpolate } from "@/i18n";
import { StarRating } from "./star-rating";
import {
  OrderButton,
  type CheckoutDelivery,
  type CheckoutMethod,
} from "./cart/order-sheet";

export function ProductCard({
  product,
  shop,
  layout,
  methods,
  deliveryOptions,
  t,
  locale,
}: {
  product: ProductCardData;
  shop: Shop;
  layout: "grid" | "list";
  methods: CheckoutMethod[];
  deliveryOptions: CheckoutDelivery[];
  t: Dictionary;
  /** The shop's resolved language, so a price is punctuated like its page. */
  locale: string;
}) {
  const href = `/${shop.handle}/p/${product.slug}`;
  const image = product.images[0];

  // With options, the card quotes the cheapest combination rather than a price
  // the buyer might not be able to get.
  const variants = toCheckoutVariants(product, product.variants);
  const range = priceRange(product, product.variants);
  const displayPrice = range.min;
  const sellable = product.inStock && anySellable(product, product.variants);

  /*
   * The struck-through price, or null when there isn't one. A boolean here
   * would say a compare-at price exists without carrying it, leaving the only
   * line that needs it to assert what the flag already proved.
   */
  const wasPriced =
    !range.varies &&
    product.compareAtCents !== null &&
    product.compareAtCents > displayPrice
      ? product.compareAtCents
      : null;
  const kindLabel =
    product.kind === "digital"
      ? t.shop.labelDigital
      : product.kind === "service"
        ? t.shop.labelService
        : null;

  return (
    <article
      className={cn(
        // Shadow only, never a transform: this card is an ancestor of the
        // checkout trigger, and a transformed ancestor becomes the containing
        // block for the panel's `position: fixed` — which renders the whole
        // modal inside this grid cell while the pointer is over the card.
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

        {!sellable ? (
          <span className="absolute start-2 top-2 rounded-full bg-black/75 px-2 py-0.5 text-[11px] font-medium text-white">
            {t.shop.soldOut}
          </span>
        ) : wasPriced !== null ? (
          <span className="absolute start-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
            {t.shop.sale}
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
              {/* A catalogue can hold both scripts, so each title picks its
                  own direction — otherwise an English name in an Arabic shop
                  truncates from the front and loses its first word. */}
              <h3
                dir="auto"
                className="truncate text-sm font-semibold leading-snug"
              >
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
            <p dir="auto" className="text-muted mt-1 line-clamp-2 text-xs">
              {product.description}
            </p>
          ) : null}

          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tabular-nums">
              {displayPrice > 0
                ? range.varies
                  ? interpolate(t.shop.from, {
                      price: formatMoney(displayPrice, shop.currency, locale),
                    })
                  : formatMoney(displayPrice, shop.currency, locale)
                : t.common.free}
            </span>
            {wasPriced !== null ? (
              <span className="text-muted text-xs line-through tabular-nums">
                {formatMoney(wasPriced, shop.currency, locale)}
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
            methods={methods}
            deliveryOptions={deliveryOptions}
            kind={product.kind}
            options={product.options}
            variants={variants}
            unitsLeft={unitsLeft(product)}
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
            imageUrl={image?.url ?? null}
            contactEmail={shop.contactEmail}
            inStock={product.inStock}
            compact
            t={t}
            className="accent-bg h-9 w-full rounded-lg text-xs font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
      </div>
    </article>
  );
}
