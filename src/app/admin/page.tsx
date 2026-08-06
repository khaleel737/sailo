import type { Metadata } from "next";
import { orderSummaryTitle } from "@/lib/order-lines";
import Link from "next/link";
import { ArrowRight, Eye, ShoppingBag, Users, Wallet } from "lucide-react";
import { requireShop } from "@/lib/session";
import {
  getDashboardStats,
  getRevenueSeries,
  getShopOrders,
  getVisitBreakdown,
  getVisitSeries,
} from "@/lib/queries";
import { Chart } from "@/components/shared/chart";
import { TrafficPanel } from "@/app/admin/_components/traffic-panel";
import { RangePicker } from "@/app/admin/_components/range-picker";
import { analyticsLimit, clampAnalyticsRange, planFor } from "@/lib/plans";
import { CopyLink } from "@/components/shared/copy-link";
import { Badge, Card, EmptyState, Stat } from "@/components/ui";
import { orderStatusLabel, orderStatusTone } from "@/lib/order-status";
import { formatMoney } from "@/lib/utils";
import { getAdminT, getLocale, getT } from "@/i18n/server";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverviewPage({
  searchParams,
}: PageProps<"/admin">) {
  const { shop } = await requireShop();
  const { t } = await getT();
  const { a } = await getAdminT();
  const locale = await getLocale();
  const params = await searchParams;

  // Clamped server-side, so a hand-typed ?range= can't read past the plan.
  const range = clampAnalyticsRange(shop, Number(params.range) || undefined);
  const chartDays = Math.min(range, 60);

  const [stats, visitSeries, revenueSeries, traffic, orders] =
    await Promise.all([
      getDashboardStats(shop.id, range),
      getVisitSeries(shop.id, chartDays),
      getRevenueSeries(shop.id, chartDays),
      getVisitBreakdown(shop.id, range),
      getShopOrders(shop.id, 5),
    ]);

  const money = (cents: number) => formatMoney(cents, shop.currency);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
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
          <div className="flex shrink-0 gap-2">
            <CopyLink url={shopUrl} />
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 dir="auto" className="text-sm font-medium text-ink-500">
          Last{" "}
          {range >= 365 ? `${Math.round(range / 365)} year` : `${range} days`}
          {range >= 365 && range >= 730 ? "s" : ""}
        </h2>
        <RangePicker
          t={t}
          current={range}
          limit={analyticsLimit(shop)}
          currentPlan={planFor(shop).id}
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<Eye className="size-4" />}
          label={a.dashboard.visits}
          value={stats.visitsInRange.toLocaleString()}
        />
        <Stat
          icon={<Users className="size-4" />}
          label={a.dashboard.uniqueVisitors}
          value={stats.uniqueVisitorsInRange.toLocaleString()}
        />
        <Stat
          icon={<ShoppingBag className="size-4" />}
          label={a.dashboard.orders}
          value={stats.totalOrders.toLocaleString()}
          hint={stats.newOrders > 0 ? `${stats.newOrders} new` : undefined}
        />
        <Stat
          icon={<Wallet className="size-4" />}
          label={a.dashboard.netRevenue}
          value={money(stats.netRevenueCents)}
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

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <Chart
            title={`Visits · last ${chartDays} days`}
            defaultShape="line"
            days={visitSeries.map((d) => d.day)}
            series={[
              {
                key: "visits",
                label: "Views",
                values: visitSeries.map((d) => d.count),
              },
              // The gap between the two lines is repeat viewing — the number
              // that tells a link that is working from one being refreshed.
              {
                key: "unique",
                label: "Visitors",
                values: visitSeries.map((d) => d.unique),
              },
            ]}
            tone="activity"
            unit="count"
            emptyLabel={a.dashboard.noVisits}
          />
        </Card>
        <Card className="p-5">
          <Chart
            title={`Revenue · last ${chartDays} days`}
            days={revenueSeries.map((d) => d.day)}
            series={[
              {
                key: "sales",
                label: "Sales",
                depth: 1,
                values: revenueSeries.map((d) => d.grossCents),
              },
              // Below the axis: money leaving, on the day it left.
              {
                key: "refunds",
                label: "Refunds",
                negative: true,
                depth: 2,
                values: revenueSeries.map((d) => d.refundedCents),
              },
              {
                key: "net",
                label: "Net",
                depth: 0,
                readoutOnly: true,
                values: revenueSeries.map((d) => d.cents),
              },
            ]}
            totalKey="net"
            tone="money"
            unit="money"
            currency={shop.currency}
            emptyLabel={a.dashboard.noRevenue}
          />
        </Card>
      </div>

      <TrafficPanel data={traffic} days={range} locale={locale} />

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
                    {orderSummaryTitle(order)}
                    {order.itemCount === 1 && order.quantity > 1 ? (
                      <span className="text-ink-400"> ×{order.quantity}</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-ink-500">
                    {order.customerName ?? "Anonymous"} ·{" "}
                    {order.createdAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-medium tabular-nums">
                    {formatMoney(order.totalCents, order.currency)}
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
    </>
  );
}
