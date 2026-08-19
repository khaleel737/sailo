import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Trash2 } from "lucide-react";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { offerPerformance } from "@sailo/commerce/orders/server";
import { deleteOffer } from "@/lib/actions/offers-admin";
import { OfferForm } from "./_components/offer-form";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { Badge, Button, Card, PageHeader } from "@sailo/design-system/web";
import { can, cheapestPlanWith } from "@sailo/core/plans";
import { formatMoney } from "@sailo/core/currency";

export const metadata: Metadata = { title: "Offers" };

/**
 * Order bumps and cross-sells, on one screen — specs 08 and 36.
 *
 * WHY BOTH LIVE HERE
 *
 * Spec 08 proposed a bump picker on the product form: one bump per product,
 * which was its own stated v1 limit. Spec 36 supersedes it with a table, and
 * once there is a table the seller's question stops being "what goes with this
 * product" and becomes "what am I offering, where, and is it working" — which
 * is a list, not a field.
 *
 * TAKE-RATE IS THE POINT OF THE LIST
 *
 * `offer_events` exists so a seller can read `taken / shown`, and this screen is
 * why. An offer with no impressions shows **no rate at all** rather than 0% —
 * printing zero beside an offer nobody has seen would tell a seller it is
 * failing when the truth is that it has not run, and those two facts lead to
 * opposite decisions.
 */
export default async function OffersPage() {
  const { a, locale } = await getAdminT();
  const { shop } = await requireShop("products:read");

  const allowed = can(shop, "offers");

  const [rows, catalogue] = await Promise.all([
    allowed ? offerPerformance(shop.id) : Promise.resolve([]),
    getDb().query.products.findMany({
      where: and(eq(products.shopId, shop.id), eq(products.isPublished, true)),
      orderBy: [asc(products.position)],
      columns: { id: true, title: true },
      limit: 200,
    }),
  ]);

  if (!allowed) {
    return (
      <>
        <PageHeader title={a.products.offersTitle} description={a.products.offersDescription} />
        <Card className="p-6">
          <p className="text-sm text-ink-500">
            {interpolate(a.products.offersLocked, {
              plan: cheapestPlanWith("offers")?.name ?? "Pro",
            })}
          </p>
          <Link
            href="/admin/billing"
            className="focus-ring mt-3 inline-flex items-center gap-1 rounded text-xs font-medium text-brand-700 transition hover:text-brand-800 pointer-coarse:min-h-11"
          >
            {a.common.upgrade}
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title={a.products.offersTitle} description={a.products.offersDescription} />

      {rows.length > 0 ? (
        <Card className="mb-5 divide-y divide-ink-100">
          {rows.map(({ offer, shown, taken, rate }) => (
            <div
              key={offer.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {offer.title ?? a.products.offerUntitled}
                  </p>
                  <Badge tone={offer.placement === "bump" ? "blue" : "neutral"}>
                    {offer.placement === "bump"
                      ? a.products.offerPlacementBump
                      : a.products.offerPlacementCrossSell}
                  </Badge>
                  {offer.isActive ? null : (
                    <Badge tone="neutral">{a.common.off}</Badge>
                  )}
                </div>
                <p className="text-xs text-ink-500">
                  {/*
                    No rate at all where nothing has been shown. "0%" beside an
                    offer nobody has seen says it is failing; the truth is that
                    it has not run, and the two lead to opposite decisions.
                  */}
                  {rate === null
                    ? a.products.offerNotShownYet
                    : interpolate(a.products.offerTakeRate, {
                        rate: `${Math.round(rate * 100)}`,
                        taken: String(taken),
                        shown: String(shown),
                      })}
                  {offer.priceCents !== null
                    ? ` · ${formatMoney(offer.priceCents, shop.currency, locale)}`
                    : ""}
                </p>
              </div>

              <form action={deleteOffer}>
                <input type="hidden" name="id" value={offer.id} />
                <Button
                  variant="ghost"
                  size="sm"
                  type="submit"
                  aria-label={a.common.delete}
                  className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="size-4" />
                </Button>
              </form>
            </div>
          ))}
        </Card>
      ) : (
        <Card className="mb-5 p-6">
          <p className="text-sm text-ink-500">{a.products.offersEmpty}</p>
        </Card>
      )}

      <OfferForm
        products={catalogue}
        currency={shop.currency}
        timeZone={shop.timeZone}
      />
    </>
  );
}
