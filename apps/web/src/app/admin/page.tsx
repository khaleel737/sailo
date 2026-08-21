import type { Metadata } from "next";
import { orderSummaryTitle } from "@/lib/order-lines";
import Link from "next/link";
import { ArrowRight, Eye, ShoppingBag, Users, Wallet } from "lucide-react";
import { requireShop } from "@/lib/session";
import {
  getCheckoutMethods,
  getDashboardStats,
  getRevenueSeries,
  getShopOrders,
  getVisitSeries,
  orderCurrencyMix,
} from "@/lib/queries";
import { setupSteps } from "@sailo/core/onboarding";
import { getPartnerCard } from "@sailo/partners/store";
import { ShareLinkButton } from "@/app/admin/_components/share-link-dialog";
import { SetupChecklist } from "@/app/admin/_components/setup-checklist";
import { ReferralCard } from "@/app/admin/_components/referral-card";
import { CopyLink } from "@sailo/design-system/web";
import { Badge, Card, EmptyState, Sparkline, Stat } from "@sailo/design-system/web";
import { orderStatusLabel, orderStatusTone } from "@sailo/core/order-status";
import { formatMoney } from "@sailo/core/currency";
import { getAdminT, getLocale } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { appOrigin } from "@sailo/core/origin";
import { CHART, CHART_STEPS } from "@sailo/design-system/chart/palette";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  const { shop } = await requireShop("orders:read");
  const { a } = await getAdminT();
  const locale = await getLocale();
  /*
   * A fixed thirty-day snapshot — the split (docs/admin-redesign 08) moved
   * the range picker, the charts and every breakdown to /admin/analytics.
   * Home's job is "what do I do next"; these four tiles are a glance, and
   * the strip's heading links to the page that answers the follow-up.
   */
  const DAYS = 30;

  const [
    stats,
    visitSeries,
    revenueSeries,
    orders,
    /*
     * The setup card's "can this shop be paid" step, answered by the same
     * function the storefront's checkout asks — enabled, configured, and
     * within the plan. A second opinion written here would be the twin that
     * drifts: it would tell a seller they were set up while their buyers saw
     * no way to pay.
     */
    usableRails,
    partnerCard,
    currencyMix,
  ] = await Promise.all([
    getDashboardStats(shop.id, DAYS),
    getVisitSeries(shop.id, DAYS),
    getRevenueSeries(shop.id, DAYS),
    getShopOrders(shop.id, 5),
    getCheckoutMethods(shop.id),
    /*
     * Read-only, unlike the version this replaces. A seller used to have a
     * referral code minted for them on this render; now they are a *partner*
     * or they are not, and joining is a decision they make on /partners rather
     * than one a page render makes on their behalf.
     */
    getPartnerCard(shop.userId),
    /*
     * What was taken in a currency that is not the shop's own — spec 53.
     *
     * Empty for every shop that has not enabled regional pricing, which is
     * every shop the day this ships, and empty again for one that has enabled
     * it and sold nothing in it yet. The revenue tile is unchanged in both
     * cases; only a shop that has actually taken euros grows a second line.
     */
    orderCurrencyMix(shop.id, shop.currency, DAYS),
  ]);

  const steps = setupSteps({
    avatarUrl: shop.avatarUrl,
    logoUrl: shop.logoUrl,
    socials: shop.socials,
    productCount: stats.totalProducts,
    enabledRailCount: usableRails.length,
    stripeChargesEnabled: shop.stripeChargesEnabled,
  });

  const money = (cents: number) => formatMoney(cents, shop.currency, locale);

  const base = appOrigin();
  const shopUrl = `${base}/${shop.handle}`;
  const displayUrl = shopUrl.replace(/^https?:\/\//, "");

  return (
    <>
      {/*
        The link is the product, so it leads the page.

        It used to lead in a slab of brand green, which made the loudest thing
        on the screen a colour rather than the URL itself, and set the seller's
        own accent against ours the moment they scrolled to their shop. Ink
        instead: the same inverted surface the brand pages use, with the green
        kept for the live dot beside the address. The URL is now the brightest
        thing in the block, which is what it should have been all along.
      */}
      <div className="relative mb-6 overflow-hidden rounded-3xl bg-ink-950 p-5 text-white sm:p-6">
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-400">
              <span className="size-1.5 rounded-full bg-brand-500" />
              {a.dashboard.shopLink}
            </p>
            <p
              dir="ltr"
              className="mt-2 truncate text-lg font-semibold tracking-tight sm:text-xl"
            >
              {displayUrl}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <CopyLink url={shopUrl} />
            {/*
              The same link as a picture — spec'd alongside the storefront's
              share sheet. The seller at a market stall doesn't paste a URL;
              they hold this up, or print the PNG it downloads.
            */}
            <ShareLinkButton
              url={shopUrl}
              title={a.share.shopTitle}
              body={a.share.shopBody}
              fileName={shop.handle}
              variant="onDark"
            />
            <a
              href={`/${shop.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring press inline-flex h-9 pointer-coarse:h-11 items-center gap-1.5 rounded-xl bg-white px-3.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-100"
            >
              {a.common.visit}
              <ArrowRight className="size-3.5 rtl:rotate-180" />
            </a>
          </div>
        </div>
      </div>

      {/*
        Directly under the link, above the numbers.

        A seller with three of these outstanding has no numbers worth reading
        yet — the charts are flat because the shop is not finished. It renders
        itself away once every step is ticked or the seller dismisses it.
      */}
      <SetupChecklist shopId={shop.id} steps={steps} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 dir="auto" className="text-sm font-medium text-ink-500">
          {interpolate(a.dashboard.lastDays, { days: DAYS })}
        </h2>
        <Link
          href="/admin/analytics"
          className="focus-ring inline-flex items-center gap-1 rounded text-xs font-medium text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11"
        >
          {a.products.viewAnalytics}
          <ArrowRight className="size-3.5 rtl:rotate-180" />
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/*
          Every tile carries a day-by-day sparkline — the Analytics grammar:
          the figure says where you are, the line says which way you've been
          going. Colour follows the chart palette's one distinction — traffic
          in the activity blue, orders and revenue in the money green — with
          the second series of each class a step lighter.
        */}
        <Stat
          icon={<Eye className="size-4" />}
          label={a.dashboard.visits}
          value={stats.visitsInRange.toLocaleString()}
          chart={
            <Sparkline
              values={visitSeries.map((d) => d.count)}
              color={CHART.activity}
            />
          }
        />
        <Stat
          icon={<Users className="size-4" />}
          label={a.dashboard.uniqueVisitors}
          value={stats.uniqueVisitorsInRange.toLocaleString()}
          chart={
            <Sparkline
              values={visitSeries.map((d) => d.unique)}
              color={CHART_STEPS.activity[1]}
            />
          }
        />
        <Stat
          icon={<ShoppingBag className="size-4" />}
          label={a.dashboard.orders}
          value={stats.totalOrders.toLocaleString()}
          chart={
            <Sparkline
              values={revenueSeries.map((d) => d.orders)}
              color={CHART_STEPS.money[1]}
            />
          }
          hint={
            [
              stats.newOrders > 0 ? `${stats.newOrders} new` : null,
              /*
                Leads, beside orders rather than in a tile of their own — spec
                07 asks for a first-class number and this is the honest place
                for it: they are the other thing a visitor can turn into, and a
                fifth tile would push revenue onto a second row on a phone.
                Absent entirely for the shops that run no enquiry form, which
                is nearly all of them.
              */
              stats.leadsInRange > 0
                ? interpolate(a.dashboard.leads, {
                    count: stats.leadsInRange.toLocaleString(),
                  })
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        />
        <Stat
          icon={<Wallet className="size-4" />}
          label={a.dashboard.netRevenue}
          value={money(stats.netRevenueCents)}
          chart={
            <Sparkline
              values={revenueSeries.map((d) => d.cents)}
              color={CHART.money}
            />
          }
          hint={
            [
              stats.refundedCents > 0
                ? `${money(stats.refundedCents)} refunded`
                : null,
              // Tax is collected, not earned — worth naming next to revenue so
              // the seller knows how much of it isn't theirs.
              stats.taxCollectedCents > 0
                ? `${money(stats.taxCollectedCents)} tax collected`
                : null,
              /*
                And what was taken in another currency — spec 53.

                Named beside the figure rather than folded into it, because
                adding €25 to $29 and calling the result dollars is arithmetic
                on two different units. Nothing here converts: v1 has no rate
                policy and inventing one for a dashboard tile would be the
                worst place to start.
              */
              ...currencyMix.map(
                (row) => `${formatMoney(row.grossCents, row.currency, locale)} in ${row.currency}`,
              ),
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        />
      </div>

      {stats.awaitingShipment > 0 ? (
        <Link
          href="/admin/orders"
          className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 transition hover:bg-blue-100"
        >
          <p className="text-sm text-blue-900">
            <span className="font-medium">
              {stats.awaitingShipment} order
              {stats.awaitingShipment === 1 ? "" : "s"}
            </span>{" "}
            waiting to be shipped. Add tracking when you post{" "}
            {stats.awaitingShipment === 1 ? "it" : "them"}.
          </p>
          <ArrowRight className="size-4 shrink-0 text-blue-700" />
        </Link>
      ) : null}

      {stats.awaitingConfirmation > 0 ? (
        <Link
          href="/admin/orders"
          className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 transition hover:bg-amber-100"
        >
          <p className="text-sm text-amber-900">
            <span className="font-medium">
              {stats.awaitingConfirmation}{" "}
              {stats.awaitingConfirmation === 1 ? "buyer says" : "buyers say"}
            </span>{" "}
            they&rsquo;ve sent payment. Confirm to mark as paid.
          </p>
          <ArrowRight className="size-4 shrink-0 text-amber-700" />
        </Link>
      ) : null}

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{a.dashboard.recentOrders}</h2>
          <Link
            href="/admin/orders"
            className="focus-ring inline-flex items-center rounded text-xs font-medium text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11"
          >
            {a.common.viewAll}
          </Link>
        </div>

        {orders.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="size-7" />}
            title={a.dashboard.noOrders}
            description={a.dashboard.noOrdersBody}
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {orders.map((order) => (
              <li
                key={order.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="focus-ring rounded underline-offset-2 hover:underline"
                    >
                      {orderSummaryTitle(order)}
                    </Link>
                    {order.itemCount === 1 && order.quantity > 1 ? (
                      <span className="text-ink-400"> ×{order.quantity}</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-ink-500">
                    {order.customerName ?? "Anonymous"} ·{" "}
                    {order.createdAt.toLocaleDateString(locale, {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-medium tabular-nums">
                    {formatMoney(order.totalCents, order.currency, locale)}
                  </span>
                  <Badge tone={orderStatusTone(order.status)} dot>
                    {orderStatusLabel(order.status, a.orderStatus)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/*
        Always drawn now. Every state it can be in says something worth saying
        — a pitch, a decision pending, or a link and what it has earned.
      */}
      <ReferralCard
        card={partnerCard}
        currency={shop.currency}
        locale={locale}
        a={a}
      />
    </>
  );
}
