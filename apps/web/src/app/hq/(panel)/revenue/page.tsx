import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, TrendingUp, Users, Wallet } from "lucide-react";
import { PageHeader } from "@sailo/design-system/web";
import { ExportCsv } from "@/app/hq/_components/hq-export";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/hq/_components/hq-table";
import {
  BillingBadge,
  Metric,
  MetricRow,
  Money,
  SectionTitle,
  StripeLink,
  When,
} from "@/app/hq/_components/hq-ui";
import { Badge, Card } from "@sailo/design-system/web";
import {
  getPaidAccounts,
  getPlatformOverview,
  getRailAdoption,
  renewalsWithin,
} from "@/lib/hq";
import { billingState, planMonthlyCents, share } from "@/lib/hq-metrics";
import { isPaymentMethodType, PAYMENT_METHOD_DEFS } from "@/lib/payments";
import { planFor, PLANS } from "@sailo/core/plans";
import { formatMoney } from "@sailo/core/currency";

export const metadata: Metadata = { title: "Revenue" };

/** Subscriptions are billed in USD, so every figure on this page is. */
const usd = (cents: number) => formatMoney(cents, "USD");

export default async function HqRevenuePage() {
  const [overview, paid, rails] = await Promise.all([
    getPlatformOverview(),
    getPaidAccounts(),
    getRailAdoption(),
  ]);

  const { revenue } = overview;
  const renewals = renewalsWithin(paid, 30);

  return (
    <>
      <PageHeader
        title="Revenue"
        description="What Sailo earns. Subscriptions, plus 1% of every card sale — card payments land in sellers' own Stripe accounts and our share is taken as a Stripe application fee."
        action={
          <ExportCsv type="subscriptions" />
        }
      />

      <MetricRow>
        <Metric
          icon={<Wallet className="size-4" />}
          label="MRR"
          value={usd(revenue.mrrCents)}
          hint="Active subscriptions only"
        />
        <Metric
          icon={<TrendingUp className="size-4" />}
          label="ARR"
          value={usd(revenue.arrCents)}
          hint="MRR × 12"
        />
        <Metric
          icon={<Users className="size-4" />}
          label="Paying accounts"
          value={revenue.counts.paying.toLocaleString()}
          hint={`${usd(revenue.arpaCents)} average`}
        />
        <Metric
          icon={<AlertTriangle className="size-4" />}
          label="At risk"
          value={usd(revenue.atRiskCents)}
          hint={`${revenue.counts.past_due} past due`}
        />
      </MetricRow>

      <div className="mt-3">
        <MetricRow>
          <Metric
            label="Trialing"
            value={revenue.counts.trialing.toLocaleString()}
            hint={`${usd(revenue.trialCents)}/mo if they all convert`}
          />
          <Metric
            label="Comped"
            value={revenue.counts.comped.toLocaleString()}
            hint={`${usd(revenue.compedValueCents)}/mo given away`}
          />
          <Metric
            label="Canceled"
            value={revenue.counts.canceled.toLocaleString()}
            hint="Were paying, aren't now"
          />
          <Metric
            label="Free accounts"
            value={revenue.counts.free.toLocaleString()}
            hint={`${share(revenue.counts.paying, overview.shops.total)}% of shops pay`}
          />
        </MetricRow>
      </div>

      <SectionTitle>Paid, trialing and comped accounts</SectionTitle>
      <Table
        head={
          <>
            <Th>Shop</Th>
            <Th>Owner</Th>
            <Th>Plan</Th>
            <Th>State</Th>
            <Th align="end">MRR</Th>
            <Th align="end">Renews</Th>
            <Th>Stripe</Th>
          </>
        }
      >
        {paid.length === 0 ? (
          <EmptyRow colSpan={7}>
            Nobody is on a paid plan yet. The moment someone subscribes, they
            appear here.
          </EmptyRow>
        ) : (
          paid.map(({ shop, ownerName, ownerEmail }) => {
            const state = billingState(shop);
            const monthly = planMonthlyCents(shop);
            return (
              <Tr key={shop.id}>
                <Td className="max-w-56">
                  <Link
                    href={`/hq/accounts/${shop.userId}`}
                    className="focus-ring flex min-w-0 items-center rounded pointer-coarse:min-h-11"
                  >
                    <span className="block truncate font-medium text-ink-900">
                      {shop.name}
                    </span>
                    <span className="block truncate text-xs text-ink-400">
                      /{shop.handle}
                    </span>
                  </Link>
                </Td>
                <Td className="max-w-48" label="Owner">
                  <span className="block truncate">{ownerName}</span>
                  <span className="block truncate text-xs text-ink-400">
                    {ownerEmail}
                  </span>
                </Td>
                <Td label="Plan">
                  {planFor(shop).name}
                  {shop.subscriptionInterval ? (
                    <span className="text-xs text-ink-400">
                      {" "}
                      · {shop.subscriptionInterval}ly
                    </span>
                  ) : null}
                </Td>
                <Td label="State">
                  <BillingBadge shop={shop} />
                </Td>
                <Td align="end" className="tabular whitespace-nowrap" label="MRR">
                  {state === "paying" ? (
                    usd(monthly)
                  ) : state === "comped" ? (
                    <span className="text-ink-400">Comped</span>
                  ) : (
                    <span className="text-ink-400">—</span>
                  )}
                </Td>
                <Td align="end" className="text-ink-500" label="Renews">
                  <When value={shop.currentPeriodEnd} />
                  {shop.cancelAtPeriodEnd ? (
                    <span className="ms-1.5">
                      <Badge tone="amber">ending</Badge>
                    </span>
                  ) : null}
                </Td>
                <Td label="Stripe">
                  <StripeLink
                    id={shop.stripeSubscriptionId}
                    kind="subscriptions"
                  />
                </Td>
              </Tr>
            );
          })
        )}
      </Table>

      <div className="mt-8 grid items-start gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-900">
            Renewing in the next 30 days
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            What Stripe should collect, if nobody cancels.
          </p>
          {renewals.length === 0 ? (
            <p className="mt-4 text-sm text-ink-500">
              Nothing due in the next month.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-ink-100">
              {renewals.map(({ shop }) => (
                <li
                  key={shop.id}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                >
                  <Link
                    href={`/hq/accounts/${shop.userId}`}
                    className="min-w-0 truncate text-sm text-ink-900 hover:underline"
                  >
                    {shop.name}
                  </Link>
                  <span className="tabular shrink-0 text-xs text-ink-500">
                    <When value={shop.currentPeriodEnd} /> ·{" "}
                    {usd(planMonthlyCents(shop))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-900">
            How sellers take money
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            Rails configured across every shop. Card is the only one that needs
            a paid plan.
          </p>
          {rails.length === 0 ? (
            <p className="mt-4 text-sm text-ink-500">
              No payment rails configured anywhere yet.
            </p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {rails.map((rail) => (
                <li key={rail.type}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink-700">
                      {isPaymentMethodType(rail.type)
                        ? PAYMENT_METHOD_DEFS[rail.type].name
                        : rail.type}
                    </span>
                    <span className="tabular text-xs text-ink-500">
                      {rail.enabled} on · {rail.shops} set up
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-full rounded-full bg-ink-900"
                      style={{
                        width: `${share(rail.enabled, overview.shops.total)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500">
            {overview.shops.connected} shop
            {overview.shops.connected === 1 ? "" : "s"} can charge cards through
            Stripe Connect ({overview.shops.connectStarted} started onboarding).
          </p>
        </Card>
      </div>

      <SectionTitle>What sellers are moving</SectionTitle>
      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-ink-400">
              Volume, all time
            </p>
            <p className="mt-1 text-2xl font-semibold text-ink-900">
              <Money totals={overview.gmv} stacked />
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-ink-400">Last 30 days</p>
            <p className="mt-1 text-lg font-semibold text-ink-900">
              <Money totals={overview.gmvMonth} stacked />
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-500">
          None of this is Sailo revenue — it is what our sellers sold. It is the
          number that says whether the product works, and the reason the plans
          are worth paying for. Currencies are listed separately because adding
          them together would produce a figure that means nothing.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {overview.gmv.map((total) => (
            <div
              key={total.currency}
              className="flex items-center justify-between rounded-xl border border-ink-100 px-3 py-2 text-sm"
            >
              <span className="text-ink-500">{total.currency}</span>
              <span className="tabular font-medium text-ink-900">
                {formatMoney(total.cents, total.currency)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <p className="mt-8 text-xs leading-relaxed text-ink-400">
        Plan prices come from{" "}
        <code className="font-mono">lib/plans.ts</code>:{" "}
        {Object.values(PLANS)
          .filter((p) => p.monthlyCents > 0)
          .map((p) => `${p.name} ${formatMoney(p.monthlyCents)}/mo`)
          .join(" · ")}
        . A yearly subscription is counted as a twelfth of its price each month
        rather than all at once, so MRR doesn&rsquo;t spike on an anniversary.
      </p>
    </>
  );
}
