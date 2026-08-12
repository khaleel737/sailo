import Image from "next/image";
import Link from "next/link";
import { CalendarDays, Clock, Download, ImageIcon, RefreshCw } from "lucide-react";
import type { ProductCard as ProductCardData } from "@/lib/queries";
import type { Shop } from "@sailo/db/schema";
import type { Dictionary } from "@/i18n";
import { cn, formatDuration, formatMoney } from "@/lib/utils";
import {
  anySellable,
  priceRange,
  toCheckoutVariants,
  unitsLeft,
} from "@/lib/variants";
import { eventSalesOpen } from "@/lib/tickets";
import { interpolate } from "@/i18n";
import { StarRating } from "./star-rating";
import { FavoriteButton } from "./favorites/favorite-button";
import { QuickAdd } from "./cart/quick-add";

/**
 * One product on the shop page.
 *
 * The card's whole job is to earn a tap through to the product page — so the
 * entire card is the link, and the two controls riding on it stay out of the
 * way: the heart, and a quick-add bag that either drops a one-of-a-kind
 * product straight in the basket or opens a small picker for one with
 * options. "Buy now" is not on the card — checkout is a commitment to a
 * specific thing, and that choice belongs to the product page.
 */
export function ProductCard({
  product,
  shop,
  layout,
  t,
  locale,
}: {
  product: ProductCardData;
  shop: Shop;
  layout: "grid" | "list";
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
  const salesOpen = eventSalesOpen(product);
  const sellable =
    product.inStock && salesOpen && anySellable(product, product.variants);

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

  return (
    <article
      className={cn(
        // Shadow only, never a transform: the quick-add opens a
        // `position: fixed` sheet from inside this card, and a transformed
        // ancestor would become its containing block — rendering the whole
        // sheet inside this grid cell.
        "surface-card group relative overflow-hidden rounded-2xl transition hover:shadow-md",
        layout === "list" && "flex gap-4 p-3",
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden bg-black/5",
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
            {salesOpen ? t.shop.soldOut : t.shop.salesClosed}
          </span>
        ) : wasPriced !== null ? (
          <span className="absolute start-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
            {t.shop.sale}
          </span>
        ) : null}

        {/* The photo's lower corner, opposite the heart. Above the stretched
            link, or the tap would navigate instead of adding.

            Never for a membership: it needs a subscription-mode checkout that
            a basket cannot be, so a quick-add would build a cart the buyer
            only finds out is unpayable after filling in the whole form. The
            product page's Subscribe button is the only way in. */}
        {sellable && layout === "grid" && product.kind !== "membership" ? (
          <QuickAdd
            productId={product.id}
            productTitle={product.title}
            priceCents={product.priceCents}
            currency={shop.currency}
            kind={product.kind}
            options={product.options}
            variants={variants}
            unitsLeft={unitsLeft(product)}
            imageUrl={image?.url ?? null}
            className="absolute bottom-2 end-2 z-[2] size-8"
            t={t}
          />
        ) : null}
      </div>

      {/* Above the stretched link, or every tap on them would navigate. */}
      <FavoriteButton
        shopId={shop.id}
        item={{
          productId: product.id,
          slug: product.slug,
          title: product.title,
          imageUrl: image?.url ?? null,
          priceCents: displayPrice,
        }}
        label={t.shop.saveToFavorites}
        className="absolute end-2 top-2 z-[2] size-8"
      />
      {/* In a list row the photo is a thumbnail, so the bag takes the row's
          own corner instead of covering a third of the picture. */}
      {sellable && layout === "list" ? (
        <QuickAdd
          productId={product.id}
          productTitle={product.title}
          priceCents={product.priceCents}
          currency={shop.currency}
          kind={product.kind}
          options={product.options}
          variants={variants}
          unitsLeft={unitsLeft(product)}
          imageUrl={image?.url ?? null}
          className="absolute bottom-2 end-2 z-[2] size-8"
          t={t}
        />
      ) : null}

      <div
        className={cn(
          "flex flex-1 flex-col",
          layout === "grid" ? "p-3" : "min-w-0 py-0.5 pe-8",
        )}
      >
        <div className="flex-1">
          <Link
            href={href}
            className="min-w-0 after:absolute after:inset-0 after:z-[1] after:content-['']"
          >
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

          <KindMeta product={product} locale={locale} t={t} />

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
      </div>
    </article>
  );
}

/**
 * The line that tells each kind's one deciding fact — when the event is, how
 * long the appointment takes, that the file arrives instantly, which sizes a
 * shirt comes in. What a buyer needed the product page to learn before, the
 * card now answers where the comparing actually happens.
 */
function KindMeta({
  product,
  locale,
  t,
}: {
  product: ProductCardData;
  locale: string;
  t: Dictionary;
}) {
  if (product.kind === "event") {
    return (
      <Meta icon={<CalendarDays className="size-3 shrink-0 opacity-70" />}>
        {product.eventStartsAt
          ? product.eventStartsAt.toLocaleString(locale, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })
          : t.shop.kindEvent}
      </Meta>
    );
  }

  if (product.kind === "digital") {
    return (
      <Meta icon={<Download className="size-3 shrink-0 opacity-70" />}>
        {t.shop.kindDigital}
      </Meta>
    );
  }

  if (product.kind === "membership") {
    return (
      <Meta icon={<RefreshCw className="size-3 shrink-0 opacity-70" />}>
        {product.billingInterval === "year"
          ? t.shop.kindMembershipYear
          : t.shop.kindMembershipMonth}
      </Meta>
    );
  }

  if (product.kind === "service") {
    return (
      <Meta icon={<Clock className="size-3 shrink-0 opacity-70" />}>
        {product.durationMinutes
          ? `${interpolate(t.checkout.duration, {
              duration: formatDuration(product.durationMinutes),
            })} · ${
              product.serviceMode === "online"
                ? t.checkout.online
                : t.checkout.inPerson
            }`
          : t.shop.kindService}
      </Meta>
    );
  }

  // Physical: the choices themselves — "S · M · L" says more than "3 sizes".
  const values = product.options[0]?.values;
  if (!values?.length) return null;
  return <Meta>{values.join(" · ")}</Meta>;
}

function Meta({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p className="text-muted mt-0.5 flex items-center gap-1 text-xs">
      {icon}
      <span className="truncate">{children}</span>
    </p>
  );
}
