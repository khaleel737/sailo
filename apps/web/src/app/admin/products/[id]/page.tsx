import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ExternalLink } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminProduct, getShopCategories } from "@/lib/queries";
import { ProductForm } from "@/app/admin/products/_components/product-form";
import { PageHeader } from "@sailo/design-system/web";
import { isUuid } from "@sailo/core/uuid";
import { getAdminT } from "@/i18n/server";
import { connectState } from "@sailo/commerce/orders/server";
import { can, cheapestPlanWith } from "@sailo/core/plans";
import { poolCounts } from "@sailo/commerce/catalog";
import { sessionsFor, tiersFor } from "@sailo/commerce/ticketing";
import { CodePoolCard } from "@/app/admin/products/_components/code-pool-card";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({
  params,
}: PageProps<"/admin/products/[id]">) {
  const { a } = await getAdminT();
  const { id } = await params;
  const { shop } = await requireShop("products:read");
  if (!isUuid(id)) notFound();

  const product = await getAdminProduct(shop.id, id);
  if (!product) notFound();

  const categories = await getShopCategories(shop.id);

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

  return (
    <>
      <PageHeader
        title={a.products.edit}
        action={
          <Link
            href={`/${shop.handle}/p/${product.slug}`}
            target="_blank"
            className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition hover:text-ink-900"
          >
            {a.products.viewOnShop}
            <ExternalLink className="size-3.5" />
          </Link>
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
        cardReady={connectState(shop) === "active" && can(shop, "cardRails")}
        /* Spec 53. Gated here and again in `saveProduct`: a form is not a
           gate, and a downgraded shop keeps every price it typed. */
        regionalCurrencies={can(shop, "regionalPricing") ? shop.regionalCurrencies : []}
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
