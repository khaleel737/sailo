import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin } from "lucide-react";
import {
  getCheckoutOptions,
  getProductBySlug,
  getShopByHandle,
} from "@/lib/queries";
import { ProductGallery } from "@/app/[handle]/p/[slug]/_components/product-gallery";
import { BuyBox } from "@/app/[handle]/p/[slug]/_components/buy-box";
import { LeadForm } from "@/app/[handle]/p/[slug]/_components/lead-form";
import { readQuestions } from "@sailo/core/lead-questions";
import { VariantPhotoProvider } from "@/app/[handle]/p/[slug]/_components/variant-photo";
import { ShareButton } from "@/app/[handle]/_components/share-button";
import { CartRegion } from "@/app/[handle]/_components/cart/cart-region";
import { complianceOf } from "@/app/[handle]/_components/cart/checkout.types";
import { ReviewForm } from "@/app/[handle]/p/[slug]/_components/review-form";
import { StarRating } from "@/app/[handle]/_components/star-rating";
import { ShopTracking } from "@/app/[handle]/_components/shop-tracking";
import { VisitTracker } from "@/app/[handle]/_components/visit-tracker";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { getShopT } from "@/i18n/server";
import { displayCurrency } from "@/lib/regional";
import { CurrencySwitcher } from "../../_components/currency-switcher";
import { interpolate } from "@sailo/i18n";
import { formatDuration } from "@sailo/core/format";
import { isShopLive } from "@sailo/core/visibility";
import { shopThemeVars } from "@sailo/design-system/web/cn";
import {
  anySellable,
  deliveryOf,
  needsDelivery,
  priceRange,
  cartCanPayInPerson,
  toCheckoutVariants,
  unitsLeft,
} from "@sailo/core/variants";
import { railsForOrder } from "@/lib/payments";
import { PoweredBy } from "@/components/shared/powered-by";
import { absolute } from "@sailo/core/origin";
import { breadcrumbJsonLd, productJsonLd } from "@/lib/seo";
import { eventSalesOpen, sessionsFor, tiersFor } from "@sailo/commerce/ticketing";
import { buyableSessions, buyableTiers } from "@sailo/core/catalog";
import {
  isPwyw,
  pwywFloorCents,
  pwywSuggestedCents,
  sellWindowState,
} from "@sailo/core/pricing-models";
import {
  offersStockRequest,
  preorderExpectedAt,
  takesPreorders,
} from "@sailo/core/preorders";

/**
 * The rails where a phone number is worth collecting — spec 33.
 *
 * Sailo never sends to one; the seller does, from their own number, through the
 * `wa.me` link on their own screen. So the field belongs only where the shop
 * already talks to buyers that way — offering it on a card-only shop would be
 * collecting a number nobody will ever use.
 */
const CHAT_RAILS = new Set(["whatsapp", "telegram", "instagram", "phone"]);

export async function generateMetadata({
  params,
}: PageProps<"/[handle]/p/[slug]">): Promise<Metadata> {
  const { handle, slug } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop) return { title: "Not found" };

  const product = await getProductBySlug(shop.id, slug, shop.currency, shop.currency);
  if (!product) return { title: "Not found" };

  const url = absolute(`/${shop.handle}/p/${product.slug}`);

  return {
    // The seller's own brand, not ours — see the note on the shop page.
    title: { absolute: `${product.title} · ${shop.name}` },
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
      type: "website",
      // Drawn by `opengraph-image.tsx` in this segment: the photo, the name and
      // the price on one 1200x630 card. The bare product photo used to go here,
      // at whatever aspect ratio the seller happened to upload.
    },
    twitter: {
      card: "summary_large_image",
      title: product.title,
      description: product.description ?? undefined,
    },
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: PageProps<"/[handle]/p/[slug]">) {
  const { handle, slug } = await params;
  const row = await getShopByHandle(handle);
  if (!row || !isShopLive(row)) notFound();

  /*
   * The currency this visit is quoted in — spec 53, and the same substitution
   * `get-shop-page-data.ts` makes: `shop.currency` becomes what the buyer is
   * being shown, so every `formatMoney` on this page and in the buy box below
   * needs no change at all. The stored row is untouched.
   */
  const display = await displayCurrency(row);
  const shop =
    display.currency === row.currency ? row : { ...row, currency: display.currency };

  const product = await getProductBySlug(shop.id, slug, display.currency, row.currency);
  if (!product || !product.isPublished) notFound();

  const checkout = await getCheckoutOptions(shop.id, display.currency, row.currency);
  const { locale, t, dir } = await getShopT(shop.locale);
  /*
   * The badge answers "what happens after I pay?", so a lead product has none:
   * nothing is paid and nothing ships. Without this it fell through to the
   * default and an enquiry form advertised itself as "Ships to you".
   */
  const kindLabel =
    product.kind === "lead"
      ? null
      : product.kind === "digital"
      ? t.shop.kindDigital
      : product.kind === "service"
        ? t.shop.kindService
        : product.kind === "event"
          ? t.shop.kindEvent
          : product.kind === "membership"
            ? // "Renews monthly" rather than "Membership": the badge's job is
              // to answer "what happens after I pay", and for this one the
              // answer is the part people most need to see before they do.
              product.billingInterval === "year"
              ? t.shop.kindMembershipYear
              : t.shop.kindMembershipMonth
            : t.shop.kindPhysical;

  const variants = toCheckoutVariants(product, product.variants);
  /*
   * What this product can honestly claim in a search result. A download is not
   * carried by a parcel service and cannot be paid for at a door, so neither
   * term belongs in its structured data — the shop's full list was being
   * repeated onto every product regardless of what it was.
   */
  const travels = needsDelivery(product.kind);
  /*
   * Worked out once, on the server, and used three times: the structured data,
   * the buy box's rails and the sheet's first paint. The buy box used to
   * re-derive it in the browser from two of its props, which is one copy of
   * the rule too many.
   */
  const payInPerson = cartCanPayInPerson([product]);
  const productRails = {
    payment: railsForOrder(checkout.methods, payInPerson),
    delivery: travels ? checkout.deliveryOptions : [],
  };
  const range = priceRange(product, product.variants);
  const salesOpen = eventSalesOpen(product);
  /*
   * Whether the seller has this on sale right now — spec 43.
   *
   * Decided here, per request, against a fresh clock rather than inside
   * `getProductBySlug`. That read is `"use cache"` with `cacheLife("max")` and
   * never expires on a clock, so a window boundary decided inside it would be
   * frozen into an entry that outlives the window — the product would go on
   * selling past its own closing time until somebody edited the shop. Caching
   * the *row* and taking the *decision* per request is the same shape
   * `eventSalesOpen` one line above already has, and it costs two comparisons.
   *
   * `resolveLines` refuses the order regardless, so what this decides is what
   * the page says, never whether money can move.
   */
  const windowState = sellWindowState(product, null, new Date());
  const stockLeft = unitsLeft(product);

  /*
   * The bands and the dates this event is sold in — spec 50.
   *
   * **Deliberately outside `getProductBySlug`.** That read is `"use cache"` with
   * `cacheLife("max")` and never expires on a clock, and both of these carry a
   * `sold` counter that moves on every purchase: cached, the page would go on
   * offering a band that filled up an hour ago, and the buyer would meet the
   * refusal at the last step of a checkout instead of a struck-through row on
   * the page. Same argument `windowState` above makes about the sell window,
   * with a stronger reason — a window moves once, a seat count moves all night.
   *
   * Skipped entirely for anything that is not an event, which is most of the
   * catalogue, so nothing else pays for this.
   *
   * `?tier=` is how a hidden band is reached. "A comp or press tier, reachable
   * by direct link only" means the link is the credential: `buyableTiers` will
   * not list a hidden band, and naming one reveals exactly that band and no
   * other. `resolveLines` sells it whether or not the page listed it, so this
   * decides what is *shown* and never what may be bought.
   */
  const reveal = product.kind === "event" ? (await searchParams).tier : undefined;
  const [tierRows, sessionRows] =
    product.kind === "event"
      ? await Promise.all([tiersFor(product.id), sessionsFor(product.id)])
      : [[], []];
  const now = new Date();
  const tiers = buyableTiers(tierRows, {
    now,
    reveal: typeof reveal === "string" ? reveal : null,
  });
  /*
   * Only under `pick_one`. An `all_access` pass admits every date, so a picker
   * would ask the buyer to choose between things they are all getting — and a
   * chosen date would claim a seat the pass does not occupy, which
   * `resolveLines` then has to drop.
   */
  const sessions =
    product.sessionMode === "pick_one" ? buyableSessions(sessionRows, now) : [];

  /*
   * An event that has bands, none of which a buyer may have right now.
   *
   * Every band hidden, or every one outside its own window, or every date
   * already started. The lists above are empty in all three cases and an empty
   * list is how the picker says "this product has no bands" — so without this
   * the page would draw an ordinary buy button, and `resolveLines` would refuse
   * the order for naming no band. A dead button under a price is the worst of
   * the three ways to be unavailable: it is the one the buyer blames themselves
   * for.
   *
   * Counted against the *rows*, not against what was rendered, because that is
   * the difference between "there are none" and "there are none for you".
   */
  const bandsClosed = tierRows.length > 0 && tiers.length === 0;
  const datesClosed =
    product.sessionMode === "pick_one" &&
    sessionRows.length > 0 &&
    sessions.length === 0;
  const ticketsClosed = bandsClosed || datesClosed;

  const sellable =
    product.inStock &&
    salesOpen &&
    windowState === "open" &&
    !ticketsClosed &&
    anySellable(product, product.variants);

  return (
    <>
      {/*
        Structured data for the product, so a search result can carry the price
        and the stock state rather than being a bare link. Built from the same
        values the page renders, so the two cannot disagree.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            productJsonLd({
              title: product.title,
              slug: product.slug,
              description: product.description,
              images: product.images,
              priceCents: range.min,
              currency: shop.currency,
              inStock: sellable,
              avgRating: product.avgRating,
              reviewCount: product.reviewCount,
              shop: { name: shop.name, handle: shop.handle },
            }, productRails),
          ),
        }}
      />
      {/*
        The trail back to the shop, which is what lets a result read
        `sailo.store › Forno Nove › Sourdough loaf` instead of showing the raw
        URL. Two crumbs is the whole hierarchy — a product's only parent is the
        storefront it belongs to.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbJsonLd([
              { name: shop.name, path: `/${shop.handle}` },
              { name: product.title, path: `/${shop.handle}/p/${product.slug}` },
            ]),
          ),
        }}
      />
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
      blockedCountries={checkout.blockedCountries}
      customFields={checkout.customFields}
      contactEmail={shop.contactEmail}
      compliance={complianceOf(shop)}
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
      {/* The seller's own tags, and the consent request they require. Renders
          nothing unless the seller configured one in settings. */}
      <ShopTracking shop={shop} t={t} />

      <div className="mx-auto w-full max-w-[680px] px-4 pb-20 pt-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href={`/${shop.handle}`}
            className="text-muted inline-flex min-w-0 items-center gap-1.5 text-sm transition pointer-coarse:-my-3 pointer-coarse:py-3 hover:opacity-70"
          >
            <ArrowLeft className="size-4 shrink-0" />
            <span className="truncate">{shop.name}</span>
          </Link>
          <ShareButton
            url={absolute(`/${shop.handle}/p/${product.slug}`)}
            // The message a share composes: the product, then whose it is.
            title={`${product.title} · ${shop.name}`}
            heading={t.share.productTitle}
            qrFileName={product.slug}
            t={t}
            className="shrink-0"
          />
        </div>

        {/* The gallery and the buy box are siblings with the title between
            them, so the chosen combination's photo travels through here. */}
        <VariantPhotoProvider>
        <ProductGallery images={product.images} title={product.title} />

        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-2">
            {product.category ? (
              <Link
                href={`/${shop.handle}?category=${product.category.slug}`}
                className="surface-elevated text-muted inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium pointer-coarse:min-h-11 transition hover:opacity-70"
              >
                {product.category.name}
              </Link>
            ) : null}
            {kindLabel ? (
              <span className="surface-elevated text-muted inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium">
                {kindLabel}
              </span>
            ) : null}
            {product.kind === "service" && product.durationMinutes ? (
              <span className="surface-elevated text-muted inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium">
                {interpolate(t.checkout.duration, {
                  duration: formatDuration(product.durationMinutes),
                })}
              </span>
            ) : null}
            {product.kind === "service" ? (
              <span className="surface-elevated text-muted inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium">
                {product.serviceMode === "online"
                  ? t.checkout.online
                  : t.checkout.inPerson}
              </span>
            ) : null}
            {product.kind === "event" && product.eventStartsAt ? (
              <span className="surface-elevated text-muted inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium">
                {product.eventStartsAt.toLocaleString(locale, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
            {/* The venue rides in the service-location column; a ticket buyer
                needs it on the page, not after the purchase. */}
            {product.kind === "event" && product.serviceLocation ? (
              <span className="surface-elevated text-muted inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium">
                <MapPin className="size-3 shrink-0 opacity-70" />
                {product.serviceLocation}
              </span>
            ) : null}
            {!sellable ? (
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                {salesOpen ? t.shop.soldOut : t.shop.salesClosed}
              </span>
            ) : null}
          </div>

          <h1
            dir="auto"
            className="mt-3 text-2xl font-bold leading-tight tracking-tight"
          >
            {product.title}
          </h1>

          {product.reviewCount > 0 ? (
            <StarRating
              value={product.avgRating}
              count={product.reviewCount}
              size="md"
              className="mt-2"
              t={t}
            />
          ) : null}

          <div className="mt-4">
            {/*
              A lead product has no buy panel at all — spec 07. Its checkout is
              a form: no price, no quantity, no basket, no rail, because there
              is no money. Rendering both and hiding one would leave a `Buy now`
              in the markup for anything that reads it rather than looks at it.
            */}
            {product.kind === "lead" ? (
              <LeadForm
                productId={product.id}
                questions={readQuestions(product.leadQuestions)}
                askMarketingConsent={shop.askMarketingConsent}
                t={t}
              />
            ) : (
            <BuyBox
              shopId={shop.id}
              shopName={shop.name}
              productId={product.id}
              slug={product.slug}
              productTitle={product.title}
              priceCents={product.priceCents}
              compareAtCents={product.compareAtCents}
              currency={shop.currency}
              // …and an event with bands, none of which this buyer may have,
              // has nothing in stock however many seats the room holds.
              inStock={product.inStock && !ticketsClosed}
              salesOpen={salesOpen}
              methods={checkout.methods}
              deliveryOptions={checkout.deliveryOptions}
              blockedCountries={checkout.blockedCountries}
              customFields={checkout.customFields}
              kind={product.kind}
              billingInterval={product.billingInterval}
              canPayInPerson={payInPerson}
              options={product.options}
              variants={variants}
              tiers={tiers}
              sessions={sessions}
              unitsLeft={stockLeft}
              maxPerOrder={product.maxPerOrder}
              pricingMode={product.pricingMode}
              pwywFloorCents={isPwyw(product) ? pwywFloorCents(product) : 0}
              pwywSuggestedCents={
                isPwyw(product) ? pwywSuggestedCents(product) : 0
              }
              windowState={windowState}
              /*
               * Spec 33. The button and the checkout answer from the same
               * place: `resolveLines` lets a sold-out line through on exactly
               * this condition, so a button offering a preorder the order would
               * refuse is not reachable.
               */
              preorderEnabled={product.preorderEnabled}
              preorderExpectedAt={preorderExpectedAt(product)}
              takesPhone={checkout.methods.some((m) => CHAT_RAILS.has(m.type))}
              /*
               * Spec 33. Decided here rather than in the buy box because the
               * rule involves the sell window and the preorder switch as well
               * as stock, and the buy box would be a second answer to a
               * question the storefront card already asks this way.
               */
              offersStockRequest={offersStockRequest({
                sellable,
                takesPreorders: takesPreorders(product),
              })}
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
              /*
               * "You will get it once payment is confirmed", and the question
               * is whether there is an "it".
               *
               * It asked whether the product had files, which is now only one
               * of the three ways a digital product delivers — so a course
               * link and an invite code, the two where a buyer is *most*
               * unsure what they are about to receive, were the two that said
               * nothing at checkout.
               */
              hasFiles={
                product.kind === "digital" &&
                (deliveryOf(product) === "file"
                  ? product.files.length > 0
                  : Boolean(product.digitalLinkUrl ?? product.digitalAccessDetails))
              }
              heldUntilPaid={product.releaseOnPayment}
              contactEmail={shop.contactEmail}
              compliance={complianceOf(shop)}
              t={t}
            />
            )}

          </div>

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

        </div>
        </VariantPhotoProvider>

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
              {product.reviews.map((review) => {
                /*
                 * `createdAt` is typed as a Date but arrives as a string, so
                 * calling Date methods on it threw and took the whole product
                 * page down. Coerced here rather than in the query, which is
                 * being restructured in parallel.
                 */
                const posted = new Date(review.createdAt);
                return (
                <li key={review.id} className="surface-card rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">
                      {review.authorName}
                    </span>
                    <time
                      dateTime={posted.toISOString()}
                      className="text-muted text-xs"
                    >
                      {posted.toLocaleDateString(locale, {
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
                );
              })}
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
          <div className="flex flex-wrap items-center justify-center gap-2">
            <LanguageSwitcher current={locale} label={t.common.language} />
            {/*
              The product page is where most storefront traffic actually lands —
              a link in a bio goes to the shop, but an ad, a post and a share
              all go to one product. A switcher only on the index would be a
              switcher most buyers never see.
            */}
            <CurrencySwitcher
              current={display.currency}
              options={display.options}
              locale={locale}
              t={t}
            />
          </div>
        </footer>
      </div>
    </div>
    </CartRegion>
    </>
  );
}
