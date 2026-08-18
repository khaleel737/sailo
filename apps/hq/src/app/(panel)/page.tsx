import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Package,
  ShoppingBag,
  Store,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { Chart } from "@sailo/design-system/web/chart";
import { PageHeader } from "@sailo/design-system/web";
import { Table, Td, Th, Tr, EmptyRow } from "@/app/_components/hq-table";
import {
  BillingBadge,
  Metric,
  MetricRow,
  Money,
  SectionTitle,
  When,
} from "@/app/_components/hq-ui";
import { Card } from "@sailo/design-system/web";
import {
  getAccounts,
  getActivationFunnel,
  getPlatformOrderSeries,
  getPlatformOverview,
  getPlatformVolumeSeries,
  getSignupSeries,
} from "@/lib/platform";
import { VolumeChart } from "./_components/volume-chart";
import { deltaOf, share } from "@/lib/metrics";
import { PLANS } from "@sailo/core/plans";
import { formatMoney } from "@sailo/core/currency";

export const metadata: Metadata = { title: "Overview" };

export default async function HqOverviewPage() {
  const [overview, funnel, signups, orderSeries, volume, recent] =
    await Promise.all([
      getPlatformOverview(),
      getActivationFunnel(),
      getSignupSeries(30),
      getPlatformOrderSeries(30),
      getPlatformVolumeSeries(30),
      getAccounts({ sort: "newest" }),
    ]);

  const { revenue } = overview;
  const attention = [
    revenue.counts.past_due > 0
      ? {
          href: "/revenue",
          tone: "amber" as const,
          text: `${revenue.counts.past_due} subscription${revenue.counts.past_due === 1 ? "" : "s"} past due — ${formatMoney(revenue.atRiskCents, "USD")}/mo at risk.`,
        }
      : null,
    overview.shops.suspended > 0
      ? {
          href: "/accounts?shopState=suspended",
          tone: "red" as const,
          text: `${overview.shops.suspended} shop${overview.shops.suspended === 1 ? " is" : "s are"} suspended.`,
        }
      : null,
    overview.orders.awaiting > 0
      ? {
          href: "/orders?status=new",
          tone: "blue" as const,
          text: `${overview.orders.awaiting} order${overview.orders.awaiting === 1 ? "" : "s"} across the platform haven't been actioned by their seller.`,
        }
      : null,
  ].filter((item) => item !== null);

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every account on Sailo, what they're selling, and what they're worth to us."
      />

      <MetricRow>
        <Metric
          icon={<Wallet className="size-4" />}
          label="MRR"
          value={formatMoney(revenue.mrrCents, "USD")}
          hint={`${formatMoney(revenue.arrCents, "USD")} annualised`}
          href="/revenue"
        />
        <Metric
          icon={<Users className="size-4" />}
          label="Paying accounts"
          value={revenue.counts.paying.toLocaleString()}
          hint={
            revenue.counts.paying > 0
              ? `${formatMoney(revenue.arpaCents, "USD")} average`
              : "Nobody is paying yet"
          }
          href="/revenue"
        />
        <Metric
          icon={<UserPlus className="size-4" />}
          label="New registrations · 30d"
          value={overview.accounts.month.toLocaleString()}
          delta={deltaOf(overview.accounts.month, overview.accounts.prevMonth)}
          hint={`${overview.accounts.week} this week · ${overview.accounts.day} today`}
          href="/accounts"
        />
        <Metric
          icon={<ShoppingBag className="size-4" />}
          label="Seller volume · 30d"
          value={<Money totals={overview.gmvMonth} stacked />}
          hint={`${overview.orders.month.toLocaleString()} orders`}
          href="/orders?days=30"
        />
      </MetricRow>

      <div className="mt-3">
        <MetricRow>
          <Metric
            icon={<Users className="size-4" />}
            label="Accounts"
            value={overview.accounts.total.toLocaleString()}
            hint={`${overview.shops.total} with a shop`}
            href="/accounts"
          />
          <Metric
            icon={<Store className="size-4" />}
            label="Live shops"
            value={overview.shops.live.toLocaleString()}
            hint={`${overview.shops.unpublished} unpublished · ${overview.shops.suspended} suspended`}
            href="/accounts?shopState=live"
          />
          <Metric
            icon={<Package className="size-4" />}
            label="Products"
            value={overview.catalogue.products.toLocaleString()}
            hint={`${overview.catalogue.published} published`}
            href="/products"
          />
          <Metric
            icon={<ShoppingBag className="size-4" />}
            label="Orders · all time"
            value={overview.orders.total.toLocaleString()}
            delta={deltaOf(overview.orders.month, overview.orders.prevMonth)}
            hint={<Money totals={overview.gmv} />}
            href="/orders"
          />
        </MetricRow>
      </div>

      {attention.length > 0 ? (
        <div className="mt-6 space-y-2">
          {attention.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                item.tone === "red"
                  ? "flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 transition hover:bg-red-100"
                  : item.tone === "amber"
                    ? "flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 transition hover:bg-amber-100"
                    : "flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 transition hover:bg-blue-100"
              }
            >
              <span className="flex min-w-0 items-center gap-2.5 text-sm text-ink-900">
                <AlertTriangle className="size-4 shrink-0 opacity-70" />
                {item.text}
              </span>
              <ArrowRight className="size-4 shrink-0 opacity-60" />
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <Chart
            title="Registrations · last 30 days"
            days={signups.map((d) => d.day)}
            series={[
              {
                key: "signups",
                label: "Registrations",
                values: signups.map((d) => d.value),
              },
            ]}
            tone="activity"
            unit="count"
            emptyLabel="Nobody has signed up in the last 30 days."
          />
        </Card>
        <Card className="p-5">
          <Chart
            title="Orders · last 30 days"
            days={orderSeries.map((d) => d.day)}
            series={[
              {
                key: "orders",
                label: "Orders",
                values: orderSeries.map((d) => d.value),
              },
            ]}
            tone="activity"
            unit="count"
            emptyLabel="No orders in the last 30 days."
          />
        </Card>
      </div>

      <div className="mt-3">
        <Card className="p-5">
          <VolumeChart days={volume.days} currencies={volume.currencies} />
        </Card>
      </div>

      <SectionTitle>How far accounts get</SectionTitle>
      <Card className="p-5">
        <ul className="space-y-3">
          {funnel.steps.map((step) => {
            const percent = share(step.count, funnel.registered);
            return (
              <li key={step.key}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink-700">{step.label}</span>
                  <span className="tabular text-ink-900">
                    <span className="font-semibold">
                      {step.count.toLocaleString()}
                    </span>
                    <span className="ms-2 text-xs text-ink-400">
                      {percent}%
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
                  <div
                    className="h-full rounded-full bg-brand-600 transition-[width] duration-500"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-ink-400">
          Every step is measured against everyone who ever registered, so the
          gap between two rows is the drop-off between them.
        </p>
      </Card>

      <SectionTitle>Where the money comes from</SectionTitle>
      <Card className="divide-y divide-ink-100">
        {revenue.byPlan.length === 0 ? (
          <p className="p-5 text-sm text-ink-500">
            No active subscriptions yet. {revenue.counts.comped} comped account
            {revenue.counts.comped === 1 ? "" : "s"} would be worth{" "}
            {formatMoney(revenue.compedValueCents, "USD")}/mo at list price.
          </p>
        ) : (
          revenue.byPlan.map((row) => (
            <div
              key={row.plan}
              className="flex items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900">
                  {PLANS[row.plan].name}
                </p>
                <p className="text-xs text-ink-500">
                  {row.accounts} account{row.accounts === 1 ? "" : "s"} ·{" "}
                  {share(row.mrrCents, revenue.mrrCents)}% of MRR
                </p>
              </div>
              <p className="tabular shrink-0 text-sm font-semibold text-ink-900">
                {formatMoney(row.mrrCents, "USD")}
                <span className="font-normal text-ink-400">/mo</span>
              </p>
            </div>
          ))
        )}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 p-4 text-xs text-ink-500">
          <span>{revenue.counts.trialing} trialing</span>
          <span>{revenue.counts.past_due} past due</span>
          <span>{revenue.counts.canceled} canceled</span>
          <span>{revenue.counts.comped} comped</span>
          <span>{revenue.counts.free} free</span>
        </div>
      </Card>

      <SectionTitle
        action={
          <Link
            href="/accounts"
            className="focus-ring inline-flex items-center rounded text-xs font-medium text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11"
          >
            All accounts
          </Link>
        }
      >
        Newest registrations
      </SectionTitle>
      <Table
        minWidth="44rem"
        head={
          <>
            <Th>Account</Th>
            <Th>Shop</Th>
            <Th>Plan</Th>
            <Th align="end">Products</Th>
            <Th align="end">Orders</Th>
            <Th align="end">Joined</Th>
          </>
        }
      >
        {recent.rows.length === 0 ? (
          <EmptyRow colSpan={6}>Nobody has registered yet.</EmptyRow>
        ) : (
          recent.rows.slice(0, 8).map((row) => (
            <Tr key={row.userId}>
              <Td>
                <Link
                  href={`/accounts/${row.userId}`}
                  className="focus-ring flex min-w-0 items-center rounded pointer-coarse:min-h-11"
                >
                  <span className="block truncate font-medium text-ink-900">
                    {row.name}
                  </span>
                  <span className="block truncate text-xs text-ink-400">
                    {row.email}
                  </span>
                </Link>
              </Td>
              <Td label="Shop">
                {row.shop ? (
                  <span className="block truncate">/{row.shop.handle}</span>
                ) : (
                  <span className="text-ink-400">Not onboarded</span>
                )}
              </Td>
              <Td label="Plan">
                {row.shop ? <BillingBadge shop={row.shop} /> : null}
              </Td>
              <Td align="end" className="tabular" label="Products">
                {row.productCount}
              </Td>
              <Td align="end" className="tabular" label="Orders">
                {row.orderCount}
              </Td>
              <Td align="end" className="text-ink-500" label="Joined">
                <When value={row.joinedAt} />
              </Td>
            </Tr>
          ))
        )}
      </Table>
    </>
  );
}
