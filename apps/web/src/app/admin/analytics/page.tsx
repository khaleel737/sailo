import type { Metadata } from "next";
import { Eye, ShoppingBag, Users, Wallet } from "lucide-react";
import { requireShop } from "@/lib/session";
import {
  getClickBreakdown,
  getConversionFunnel,
  getDashboardStats,
  getProductPerformance,
  getRevenueSeries,
  getVisitBreakdown,
  getVisitSeries,
  orderCurrencyMix,
} from "@/lib/queries";
import { Chart } from "@sailo/design-system/web/chart";
import { TrafficPanel } from "@/app/admin/_components/traffic-panel";
import { ProductPerformancePanel } from "@/app/admin/_components/product-performance";
import { ConversionFunnelPanel } from "@/app/admin/_components/conversion-funnel";
import { RangePicker } from "@/app/admin/_components/range-picker";
import { analyticsLimit, planFor } from "@sailo/core/plans";
import { resolveAnalyticsWindow, type DateWindow } from "@sailo/analytics/window";
import { Card, PageHeader, Sparkline, Stat } from "@sailo/design-system/web";
import { formatMoney } from "@sailo/core/currency";
import { getAdminT, getLocale, getT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";

export const metadata: Metadata = { title: "Analytics" };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A card title that carries its own definition — the Analytics grammar from
 * the captures: dotted underline, the sentence on hover and on keyboard
 * focus (`title` reads out through the accessibility tree; a `button` is
 * natively keyboard-reachable). A local helper until a second page wants one.
 */
function DefTitle({ def, children }: { def: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={def}
      className="focus-ring cursor-help rounded underline decoration-ink-300 decoration-dotted underline-offset-4"
    >
      {children}
    </button>
  );
}

/** "+12%", "−8%", or nothing when the previous period has nothing to compare. */
function deltaLabel(now: number, then: number): string | null {
  if (then <= 0) return null;
  const pct = Math.round(((now - then) / then) * 100);
  return pct === 0 ? "±0%" : pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

/**
 * The numbers' own page — carved out of Home (docs/admin-redesign 08).
 *
 * Home answers "what do I do next"; this page answers "how is it going",
 * which is a different visit. Everything here reads the queries Home already
 * had, plus the one thing a range on its own could never say: the same range
 * *before* this one, drawn dashed behind the money and printed as a delta on
 * every tile.
 */
export default async function AdminAnalyticsPage({
  searchParams,
}: PageProps<"/admin/analytics">) {
  const { shop } = await requireShop("money:read");
  const { t } = await getT();
  const { a } = await getAdminT();
  const locale = await getLocale();
  const params = await searchParams;

  const window = resolveAnalyticsWindow(shop, params);

  /* The charts stay readable at sixty bars — same cap Home always applied. */
  const chartQuery: number | DateWindow = !window.custom
    ? Math.min(window.days, 60)
    : window.days <= 60
      ? (window.query as DateWindow)
      : {
          since: new Date(window.until.getTime() - 60 * DAY_MS),
          until: window.until,
        };
  const chartDays = Math.min(window.days, 60);

  /*
   * The previous period: the same span, ending where this one begins. Bounds
   * are computed from the resolved window so a preset and a custom range get
   * the same treatment, and the chart's compare uses the *chart's* own
   * (possibly clipped) span so the two lines cover the same number of days.
   */
  const spanMs = window.until.getTime() - window.since.getTime();
  const prevQuery: DateWindow = {
    since: new Date(window.since.getTime() - spanMs),
    until: window.since,
  };
  const chartSince =
    typeof chartQuery === "number"
      ? new Date(window.until.getTime() - chartQuery * DAY_MS)
      : chartQuery.since;
  const chartSpanMs = window.until.getTime() - chartSince.getTime();
  const prevChartQuery: DateWindow = {
    since: new Date(chartSince.getTime() - chartSpanMs),
    until: chartSince,
  };

  const [
    stats,
    prevStats,
    visitSeries,
    revenueSeries,
    prevRevenueSeries,
    traffic,
    clicks,
    performance,
    funnel,
    currencyMix,
  ] = await Promise.all([
    getDashboardStats(shop.id, window.query),
    getDashboardStats(shop.id, prevQuery),
    getVisitSeries(shop.id, chartQuery),
    getRevenueSeries(shop.id, chartQuery),
    getRevenueSeries(shop.id, prevChartQuery),
    getVisitBreakdown(shop.id, window.query),
    getClickBreakdown(shop.id, window.query),
    getProductPerformance(shop.id, window.query, Number(params.pp) || 1),
    getConversionFunnel(shop.id, window.query),
    orderCurrencyMix(shop.id, shop.currency, window.query),
  ]);

  const money = (cents: number) => formatMoney(cents, shop.currency, locale);

  const dateLabel = (d: Date) =>
    d.toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  const dayParam = (d: Date) => d.toISOString().slice(0, 10);
  const lastDayShown = new Date(window.until.getTime() - 1);
  const rangeLabel = window.custom
    ? `${dateLabel(window.since)} – ${dateLabel(lastDayShown)}`
    : interpolate(a.dashboard.lastDays, { days: window.days });
  const chartLabel =
    window.custom && typeof chartQuery !== "number"
      ? `${dateLabel(chartQuery.since)} – ${dateLabel(new Date(chartQuery.until.getTime() - 1))}`
      : window.custom
        ? rangeLabel
        : "";
  const rangeQuery = window.custom
    ? `from=${dayParam(window.since)}&to=${dayParam(lastDayShown)}`
    : `range=${window.days}`;

  /** The delta hint under a tile, or the tile's ordinary hint when new. */
  const vs = (now: number, then: number) => {
    const d = deltaLabel(now, then);
    return d
      ? `${d} ${interpolate(a.dashboard.vsPrevious, { days: window.days })}`
      : undefined;
  };

  return (
    <>
      <PageHeader
        title={a.navGroups.analytics}
        description={a.dashboard.analyticsIntro}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 dir="auto" className="text-sm font-medium text-ink-500">
          {rangeLabel}
        </h2>
        <RangePicker
          t={t}
          labels={a.range}
          current={window.days}
          limit={analyticsLimit(shop)}
          currentPlan={planFor(shop).id}
          custom={window.custom}
          customFrom={dayParam(window.since)}
          customTo={dayParam(lastDayShown)}
          clamped={window.clamped}
        />
      </div>

      {/* ---- The KPI strip: figure, direction, and this-vs-then ---------- */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<Eye className="size-4" />}
          label={<DefTitle def={a.dashboard.defVisits}>{a.dashboard.visits}</DefTitle>}
          value={stats.visitsInRange.toLocaleString()}
          hint={vs(stats.visitsInRange, prevStats.visitsInRange)}
          chart={
            <Sparkline
              values={visitSeries.map((d) => d.count)}
              className="text-ink-400"
            />
          }
        />
        <Stat
          icon={<Users className="size-4" />}
          label={
            <DefTitle def={a.dashboard.defUniqueVisitors}>
              {a.dashboard.uniqueVisitors}
            </DefTitle>
          }
          value={stats.uniqueVisitorsInRange.toLocaleString()}
          hint={vs(stats.uniqueVisitorsInRange, prevStats.uniqueVisitorsInRange)}
          chart={
            <Sparkline
              values={visitSeries.map((d) => d.unique)}
              className="text-ink-300"
            />
          }
        />
        <Stat
          icon={<ShoppingBag className="size-4" />}
          label={<DefTitle def={a.dashboard.defOrders}>{a.dashboard.orders}</DefTitle>}
          value={stats.totalOrders.toLocaleString()}
          hint={vs(stats.totalOrders, prevStats.totalOrders)}
        />
        <Stat
          icon={<Wallet className="size-4" />}
          label={
            <DefTitle def={a.dashboard.defNetRevenue}>
              {a.dashboard.netRevenue}
            </DefTitle>
          }
          value={money(stats.netRevenueCents)}
          hint={vs(stats.netRevenueCents, prevStats.netRevenueCents)}
          chart={
            <Sparkline
              values={revenueSeries.map((d) => d.cents)}
              className="text-brand-600"
            />
          }
        />
      </div>

      <ConversionFunnelPanel funnel={funnel} />

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <Chart
            title={
              window.custom
                ? interpolate(a.dashboard.visitsCustom, { range: chartLabel })
                : interpolate(a.dashboard.visitsRange, { days: chartDays })
            }
            defaultShape="line"
            days={visitSeries.map((d) => d.day)}
            series={[
              {
                key: "visits",
                label: a.dashboard.views,
                values: visitSeries.map((d) => d.count),
              },
              {
                key: "unique",
                label: a.dashboard.visitors,
                values: visitSeries.map((d) => d.unique),
              },
            ]}
            tone="activity"
            unit="count"
            shape={a.chart}
            locale={locale}
            emptyLabel={a.dashboard.noVisits}
          />
        </Card>
        <Card className="p-5">
          <Chart
            title={
              window.custom
                ? interpolate(a.dashboard.revenueCustom, { range: chartLabel })
                : interpolate(a.dashboard.revenueRange, { days: chartDays })
            }
            days={revenueSeries.map((d) => d.day)}
            series={[
              {
                key: "sales",
                label: a.dashboard.sales,
                depth: 1,
                values: revenueSeries.map((d) => d.grossCents),
              },
              {
                key: "refunds",
                label: a.dashboard.refunds,
                negative: true,
                depth: 2,
                values: revenueSeries.map((d) => d.refundedCents),
              },
              {
                key: "net",
                label: a.dashboard.net,
                depth: 0,
                readoutOnly: true,
                values: revenueSeries.map((d) => d.cents),
              },
              /*
               * The same span, one period earlier, day-aligned by index —
               * both series come back zero-filled so position i is the same
               * offset into either window. Dashed: the past is context.
               */
              {
                key: "previous",
                label: a.dashboard.previousPeriod,
                depth: 3,
                dashed: true,
                values: prevRevenueSeries.map((d) => d.cents),
              },
            ]}
            totalKey="net"
            tone="money"
            unit="money"
            currency={shop.currency}
            shape={a.chart}
            locale={locale}
            emptyLabel={a.dashboard.noRevenue}
          />
        </Card>
      </div>

      {/* ---- The breakdown ledger ---------------------------------------- */}
      {/*
        Two blocks, because only one subtraction here is true. Net really is
        gross minus refunds — that is its definition in `getDashboardStats` —
        so that path gets ledger arithmetic. Discounts, delivery and tax are
        *inside* gross (totals are post-discount and carry both fees), and
        printing them as further subtractions would invent money. They are
        composition notes, labelled as such.
      */}
      <Card className="mb-6 p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-900">
          <DefTitle def={a.dashboard.defBreakdown}>
            {a.dashboard.breakdownTitle}
          </DefTitle>
        </h2>
        <div className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-500">{a.dashboard.grossSales}</dt>
            <dd className="tabular-nums text-ink-700">{money(stats.grossCents)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-500">{a.dashboard.refunds}</dt>
            <dd className="tabular-nums text-red-600">
              −{money(stats.refundedCents)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-ink-100 pt-2">
            <dt className="font-semibold text-ink-900">{a.dashboard.netRevenue}</dt>
            <dd className="font-semibold tabular-nums text-ink-900">
              {money(stats.netRevenueCents)}
            </dd>
          </div>
        </dl>
        <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-ink-400">
          {a.dashboard.breakdownInside}
        </p>
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-500">{a.dashboard.discountsGiven}</dt>
            <dd className="tabular-nums text-ink-700">
              {money(stats.discountCents)}
            </dd>
          </div>
          {stats.deliveryFeeCents > 0 ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-500">{a.orders.delivery}</dt>
              <dd className="tabular-nums text-ink-700">
                {money(stats.deliveryFeeCents)}
              </dd>
            </div>
          ) : null}
          {stats.taxCollectedCents > 0 ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-500">{a.dashboard.taxCollected}</dt>
              <dd className="tabular-nums text-ink-700">
                {money(stats.taxCollectedCents)}
              </dd>
            </div>
          ) : null}
          {currencyMix.map((row) => (
            <div key={row.currency} className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-500">{row.currency}</dt>
              <dd className="tabular-nums text-ink-700">
                {formatMoney(row.grossCents, row.currency, locale)}
              </dd>
            </div>
          ))}
        </dl>
        </div>
        </div>
      </Card>

      <TrafficPanel
        data={traffic}
        clicks={clicks}
        days={window.days}
        locale={locale}
      />

      <ProductPerformancePanel
        data={performance}
        currency={shop.currency}
        locale={locale}
        rangeQuery={rangeQuery}
      />
    </>
  );
}
