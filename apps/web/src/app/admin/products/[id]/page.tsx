import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ExternalLink } from "lucide-react";
import { requireShop } from "@/lib/session";
import {
  adjacentProductIds,
  getAdminProduct,
  getShopCategories,
  productSalesSummary,
} from "@/lib/queries";
import { ProductForm } from "@/app/admin/products/_components/product-form";
import { ProductMenu } from "@/app/admin/products/_components/product-menu";
import { RecordNav } from "@/app/admin/_components/record-nav";
import { ShareLinkButton } from "@/app/admin/_components/share-link-dialog";
import { Badge, Card, PageHeader } from "@sailo/design-system/web";
import { formatMoney } from "@sailo/core/currency";
import { isUuid } from "@sailo/core/uuid";
import { getAdminT } from "@/i18n/server";
import { connectState } from "@sailo/commerce/orders/server";
import { can, cheapestPlanWith } from "@sailo/core/plans";
import { poolCounts } from "@sailo/commerce/catalog";
import { sessionsFor, tiersFor } from "@sailo/commerce/ticketing";
import { listStaff, staffIdsFor } from "@sailo/commerce/booking/server";
import { CodePoolCard } from "@/app/admin/products/_components/code-pool-card";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({
  params,
}: PageProps<"/admin/products/[id]">) {
  const { a, locale } = await getAdminT();
  const { id } = await params;
  const { shop } = await requireShop("products:read");
  if (!isUuid(id)) notFound();

  const product = await getAdminProduct(shop.id, id);
  if (!product) notFound();

  const [categories, adjacent, sales] = await Promise.all([
    getShopCategories(shop.id),
    /* The header's ↑↓ arrows — neighbours under the list's own ordering. */
    adjacentProductIds(shop.id, product.id),
    /* The rail's Sales card — lifetime, so "has this ever earned". */
    productSalesSummary(shop.id, product.id),
  ]);

  /*
   * Counts only — spec 48. The pool card renders numbers and never a string,
   * because an unclaimed code reaching this page is an unclaimed code in the
   * RSC payload. Read here rather than in the card so the card stays a client
   * component with no database of its own.
   */
  const pool =
    product.codeSource === "pool" || product.codeSource === "generated"
      ? await poolCounts(product.id)
      : null;

  /*
   * The event's bands and its dates — spec 50.
   *
   * Read here and not folded into `sellerProduct`: neither table has a drizzle
   * relation, and giving them one would put both on the phone's `products.get`
   * and on every row of the catalogue list, which render neither. Two reads on
   * the one screen that edits them is the cheaper shape.
   *
   * Only for an event, and only on a plan that has them — a shop that cannot
   * edit a band should not pay for the query either. The editor falls back to
   * an empty list, which is what a downgraded shop's card renders.
   */
  const [tiers, sessions] =
    product.kind === "event"
      ? await Promise.all([
          can(shop, "eventTiers") ? tiersFor(product.id) : [],
          can(shop, "eventSessions") ? sessionsFor(product.id) : [],
        ])
      : [[], []];

  /*
   * Who may take this service, and who already does — spec 51.
   *
   * Read here rather than in the card so the card stays a client component
   * with no database of its own, and narrowed to three fields: a person's
   * hours and calendar address are not the browser's business. Only for a
   * service, because nothing else has a diary.
   */
  const staff =
    product.kind === "service" && can(shop, "staffResources")
      ? await listStaff(shop.id)
      : [];
  const assignedStaffIds = staff.length > 0 ? await staffIdsFor(product.id) : [];

  return (
    <>
      {/*
        The record's header, Shopify's grammar: the thing's own name, its
        visibility said as a chip, and on the end the acts about the record —
        preview, the ↑↓ walk through the catalogue, and the ⋯ menu.
      */}
      <PageHeader
        back={{ href: "/admin/products", label: a.products.title }}
        title={product.title}
        meta={
          <Badge tone={product.isPublished ? "green" : "neutral"} dot>
            {product.isPublished ? a.common.live : a.common.hidden}
          </Badge>
        }
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/${shop.handle}/p/${product.slug}`}
              target="_blank"
              className="focus-ring hidden items-center gap-1.5 rounded text-sm text-ink-500 transition hover:text-ink-900 sm:inline-flex"
            >
              {a.products.viewOnShop}
              <ExternalLink className="size-3.5" />
            </Link>
            <RecordNav
              prevHref={adjacent.prev ? `/admin/products/${adjacent.prev}` : null}
              nextHref={adjacent.next ? `/admin/products/${adjacent.next}` : null}
              prevLabel={a.products.prevProduct}
              nextLabel={a.products.nextProduct}
            />
            <ProductMenu productId={product.id} />
          </div>
        }
      />
      <ProductForm
        product={product}
        categories={categories}
        currency={shop.currency}
        /* An event's clock is the shop's, and the form names it rather than
           leaving a seller to guess whose 19:00 they just typed. Spec 43's two
           window fields read the same zone, and for a stronger reason: their
           boundaries are compared to `now` on the server. */
        timeZone={shop.timeZone}
        /* Spec 43. Decided here and again in `saveProduct`, because a form is
           not a gate — a hand-rolled POST does not render this card. */
        pricingModes={can(shop, "pricingModes")}
        pricingUpgradeTo={cheapestPlanWith("pricingModes")?.name ?? null}
        /* Spec 51 — changes the hint under the weight field, nothing else. A
           seller may record what a thing weighs on any plan; what Business buys
           is charging postage by it. */
        weightBands={can(shop, "weightBands")}
        /* Spec 48. Decided here and again in `saveProduct` for the same
           reason every other gate is: a form is not a gate, and a hand-rolled
           POST does not render this card. */
        codePools={can(shop, "codePools")}
        licensing={can(shop, "licensing")}
        membershipTerms={can(shop, "membershipTerms")}
        staffResources={can(shop, "staffResources")}
        /* Spec 50. Two flags because they are two plans — bands are Pro and a
           series is Business — and both fall back rather than refusing, so a
           downgraded shop keeps its bands and dates and stops editing them. */
        eventTiers={can(shop, "eventTiers")}
        eventSessions={can(shop, "eventSessions")}
        tiers={tiers}
        sessions={sessions}
        roster={staff.map((person) => ({
          id: person.id,
          name: person.name,
          isActive: person.isActive,
        }))}
        assignedStaffIds={assignedStaffIds}
        cardReady={connectState(shop) === "active" && can(shop, "cardRails")}
        /* Spec 53. Gated here and again in `saveProduct`: a form is not a
           gate, and a downgraded shop keeps every price it typed. */
        regionalCurrencies={can(shop, "regionalPricing") ? shop.regionalCurrencies : []}
        rail={
          <>
            {/*
              Lifetime numbers, formatted in the shop's own currency — the
              same simplification the dashboard's performance table makes.
            */}
            <Card className="space-y-3 p-5">
              <h2 className="text-sm font-semibold text-ink-900">
                {a.products.salesTitle}
              </h2>
              {sales.units > 0 ? (
                <>
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-ink-500">{a.products.unitsSold}</dt>
                      <dd className="tabular-nums text-ink-700">{sales.units}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-ink-500">{a.orders.title}</dt>
                      <dd className="tabular-nums text-ink-700">{sales.orders}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-ink-500">{a.performance.revenue}</dt>
                      <dd className="font-semibold tabular-nums text-ink-900">
                        {formatMoney(sales.revenueCents, shop.currency, locale)}
                      </dd>
                    </div>
                  </dl>
                  <Link
                    href="/admin"
                    className="focus-ring inline-flex items-center rounded text-xs font-medium text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11"
                  >
                    {a.products.viewAnalytics}
                  </Link>
                </>
              ) : (
                <p className="text-sm leading-relaxed text-ink-500">
                  {a.products.salesEmpty}
                </p>
              )}
            </Card>

            <Card className="space-y-3 p-5">
              <h2 className="text-sm font-semibold text-ink-900">
                {a.products.storefront}
              </h2>
              <p dir="ltr" className="truncate text-start text-xs text-ink-500">
                /{shop.handle}/p/{product.slug}
              </p>
              <ShareLinkButton
                url={`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/${shop.handle}/p/${product.slug}`}
                title={a.products.shareTitle}
                body={a.products.shareBody}
                fileName={product.slug}
              />
            </Card>
          </>
        }
      />
      {/*
        Below the form and outside it — a pool is an inventory movement, not a
        field, and topping one up must not ride on a save that could be refused
        for a blank title.
      */}
      {pool ? (
        <CodePoolCard
          productId={product.id}
          counts={pool}
          generated={product.codeSource === "generated"}
        />
      ) : null}

      {/*
        Gated content — spec 40. A link rather than a card, and outside the form
        for the same reason the pool is: a collection is an ordered list with its
        own screen, and folding it into the longest form in the product would
        make it longer for the feature least likely to be used on any given
        visit.

        Offered on the two kinds that have a delivery page to show a collection
        on. A mug and a booking have nowhere to put one.
      */}
      {product.kind === "digital" || product.kind === "membership" ? (
        <Link
          href={`/admin/products/${product.id}/content`}
          className="focus-ring mt-5 flex items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-white p-5 transition hover:border-ink-300"
        >
          <span>
            <span className="block text-sm font-semibold text-ink-900">
              {a.content.title}
            </span>
            <span className="mt-0.5 block text-xs text-ink-500">{a.content.intro}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-ink-400 rtl:rotate-180" />
        </Link>
      ) : null}
    </>
  );
}
