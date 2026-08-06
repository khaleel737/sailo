import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowUpRight,
  CreditCard,
  Eye,
  Gift,
  Package,
  ShoppingBag,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { Chart } from "@/components/shared/chart";
import { PageHeader } from "@/components/shared/page-header";
import { AccountActions } from "./_components/account-actions";
import { Table, Td, Th, Tr } from "@/app/hq/_components/hq-table";
import {
  BillingBadge,
  Detail,
  Metric,
  MetricRow,
  Mono,
  SectionTitle,
  StripeLink,
  When,
} from "@/app/hq/_components/hq-ui";
import { Badge, Card } from "@/components/ui";
import { getAccountDetail } from "@/lib/hq";
import { billingState } from "@/lib/hq-metrics";
import { isPaymentMethodType, PAYMENT_METHOD_DEFS } from "@/lib/payments";
import { planFor } from "@/lib/plans";
import { formatMoney, isShopLive } from "@/lib/utils";
import { OrdersTable } from "./_components/orders-table";
import { CatalogueTable } from "./_components/catalogue-table";
import { AffiliatesTable } from "./_components/affiliates-table";
import { BuyersTable } from "./_components/buyers-table";

export async function generateMetadata({
  params,
}: PageProps<"/hq/accounts/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = await getAccountDetail(id);
  if (!detail) return { title: "Account" };
  return { title: detail.shop?.name ?? detail.owner.name };
}

export default async function HqAccountPage({
  params,
}: PageProps<"/hq/accounts/[id]">) {
  const { id } = await params;
  const detail = await getAccountDetail(id);
  if (!detail) notFound();

  const { owner, shop } = detail;

  /* An account that registered and stopped. Worth its own screen — this is the
     shape of the biggest leak in any signup funnel. */
  if (!shop) {
    return (
      <>
        <PageHeader
          back={{ href: "/hq/accounts", label: "Accounts" }}
          title={owner.name}
          description={owner.email}
          meta={<Badge tone="amber">Never onboarded</Badge>}
        />
        <Card className="p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Detail label="Registered">
              <When value={owner.createdAt} withTime />
            </Detail>
            <Detail label="Email verified">
              {owner.emailVerified ? "Yes" : "No"}
            </Detail>
            <Detail label="User id">
              <Mono>{owner.id}</Mono>
            </Detail>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-ink-500">
            This account has no shop, so there is nothing to sell, nothing to
            bill and nothing to see on a storefront. They stopped between
            signing up and finishing onboarding.
          </p>
        </Card>
      </>
    );
  }

  const money = (cents: number) => formatMoney(cents, shop.currency);
  const plan = planFor(shop);
  const state = billingState(shop);
  const live = isShopLive(shop);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <>
      <PageHeader
        back={{ href: "/hq/accounts", label: "Accounts" }}
        title={shop.name}
        description={`${owner.name} · ${owner.email}`}
        meta={
          <>
            <BillingBadge shop={shop} plan={plan.name} />
            {shop.suspendedAt ? (
              <Badge tone="red" dot>
                Suspended
              </Badge>
            ) : live ? (
              <Badge tone="green" dot>
                Live
              </Badge>
            ) : (
              <Badge tone="neutral" dot>
                Unpublished
              </Badge>
            )}
          </>
        }
        action={
          <a
            href={`${base}/${shop.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring press inline-flex h-10 items-center gap-2 rounded-xl pointer-coarse:h-11 border border-ink-200 bg-white px-4 text-sm font-medium text-ink-900 shadow-xs transition hover:border-ink-300 hover:bg-ink-50"
          >
            /{shop.handle}
            <ArrowUpRight className="size-4" />
          </a>
        }
      />

      {shop.suspendedAt ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-medium">
            Suspended <When value={shop.suspendedAt} withTime />
          </p>
          {shop.suspendedReason ? (
            <p className="mt-0.5 opacity-90">{shop.suspendedReason}</p>
          ) : null}
        </div>
      ) : null}

      <MetricRow>
        <Metric
          icon={<Wallet className="size-4" />}
          label="Net revenue"
          value={money(detail.stats.netRevenueCents)}
          hint={
            detail.stats.refundedCents > 0
              ? `${money(detail.stats.refundedCents)} refunded`
              : undefined
          }
        />
        <Metric
          icon={<ShoppingBag className="size-4" />}
          label="Orders"
          value={detail.stats.totalOrders.toLocaleString()}
          hint={
            detail.stats.newOrders > 0
              ? `${detail.stats.newOrders} not yet actioned`
              : undefined
          }
        />
        <Metric
          icon={<Package className="size-4" />}
          label="Products"
          value={detail.stats.totalProducts.toLocaleString()}
          hint={`${detail.stats.publishedProducts} published · ${detail.categoryCount} categories`}
        />
        <Metric
          icon={<Users className="size-4" />}
          label="Buyers"
          value={detail.buyerCount.toLocaleString()}
        />
      </MetricRow>

      <div className="mt-3">
        <MetricRow>
          <Metric
            icon={<Eye className="size-4" />}
            label="Visits · 30d"
            value={detail.stats.visitsInRange.toLocaleString()}
            hint={`${detail.stats.uniqueVisitorsInRange} unique`}
          />
          <Metric
            icon={<Gift className="size-4" />}
            label="Affiliates"
            value={detail.affiliates.length.toLocaleString()}
            hint={
              detail.stats.unpaidCommissionCents > 0
                ? `${money(detail.stats.unpaidCommissionCents)} owed`
                : undefined
            }
          />
          <Metric
            icon={<CreditCard className="size-4" />}
            label="Paid orders"
            value={money(detail.stats.paidValueCents)}
            hint={
              detail.stats.awaitingConfirmation > 0
                ? `${detail.stats.awaitingConfirmation} awaiting confirmation`
                : undefined
            }
          />
          <Metric
            icon={<Truck className="size-4" />}
            label="Tax collected"
            value={money(detail.stats.taxCollectedCents)}
            hint={
              shop.taxEnabled
                ? `${shop.taxName} at ${(shop.taxRateBp / 100).toFixed(2)}%`
                : "Tax is off"
            }
          />
        </MetricRow>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        {/* ------------------------------------------------------------ main */}
        <div className="min-w-0">
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <Card className="p-5">
              <Chart
                title="Visits · 30 days"
                days={detail.visitSeries.map((d) => d.day)}
                series={[
                  {
                    key: "visits",
                    label: "Views",
                    shape: "line",
                    values: detail.visitSeries.map((d) => d.count),
                  },
                  {
                    key: "unique",
                    label: "Visitors",
                    shape: "line",
                    values: detail.visitSeries.map((d) => d.unique),
                  },
                ]}
                tone="activity"
                unit="count"
                emptyLabel="No visits."
              />
            </Card>
            <Card className="p-5">
              <Chart
                title="Revenue · 30 days"
                days={detail.revenueSeries.map((d) => d.day)}
                series={[
                  {
                    key: "sales",
                    label: "Sales",
                    shape: "bar",
                    values: detail.revenueSeries.map((d) => d.grossCents),
                  },
                  {
                    key: "refunds",
                    label: "Refunds",
                    shape: "bar",
                    negative: true,
                    values: detail.revenueSeries.map((d) => d.refundedCents),
                  },
                  {
                    key: "net",
                    label: "Net",
                    shape: "line",
                    values: detail.revenueSeries.map((d) => d.cents),
                  },
                ]}
                totalKey="net"
                tone="money"
                unit="money"
                currency={shop.currency}
                emptyLabel="No revenue."
              />
            </Card>
          </div>

          <OrdersTable detail={detail} />
          <CatalogueTable detail={detail} shop={shop} />
          <AffiliatesTable detail={detail} shop={shop} />
          <BuyersTable detail={detail} shop={shop} />

          <SectionTitle>Checkout</SectionTitle>
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
                Payment rails
              </h3>
              {detail.payments.length === 0 ? (
                <p className="text-sm text-ink-500">
                  No rails configured — this shop can&rsquo;t take an order.
                </p>
              ) : (
                <ul className="space-y-2">
                  {detail.payments.map((method) => (
                    <li
                      key={method.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate text-ink-700">
                        {isPaymentMethodType(method.type)
                          ? PAYMENT_METHOD_DEFS[method.type].name
                          : method.type}
                      </span>
                      <Badge tone={method.isEnabled ? "green" : "neutral"}>
                        {method.isEnabled ? "On" : "Off"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
                Delivery
              </h3>
              {detail.delivery.length === 0 ? (
                <p className="text-sm text-ink-500">
                  No delivery options — digital and service shops don&rsquo;t
                  need any.
                </p>
              ) : (
                <ul className="space-y-2">
                  {detail.delivery.map((option) => (
                    <li
                      key={option.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate text-ink-700">
                        {option.name}
                        <span className="ms-1.5 text-xs text-ink-400">
                          {option.feeCents > 0
                            ? money(option.feeCents)
                            : "Free"}
                        </span>
                      </span>
                      <Badge tone={option.isEnabled ? "green" : "neutral"}>
                        {option.isEnabled ? "On" : "Off"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {detail.coupons.length > 0 ? (
            <>
              <SectionTitle>Discount codes</SectionTitle>
              <Table
                minWidth="32rem"
                head={
                  <>
                    <Th>Code</Th>
                    <Th>Discount</Th>
                    <Th align="end">Redeemed</Th>
                    <Th>State</Th>
                  </>
                }
              >
                {detail.coupons.map((coupon) => (
                  <Tr key={coupon.id}>
                    <Td>
                      <Mono>{coupon.code}</Mono>
                    </Td>
                    <Td label="Discount">
                      {coupon.discountType === "percent"
                        ? `${coupon.discountValue / 100}%`
                        : money(coupon.discountValue)}
                    </Td>
                    <Td align="end" className="tabular" label="Redeemed">
                      {coupon.timesRedeemed}
                      {coupon.maxRedemptions
                        ? ` / ${coupon.maxRedemptions}`
                        : ""}
                    </Td>
                    <Td label="State">
                      <Badge tone={coupon.isActive ? "green" : "neutral"}>
                        {coupon.isActive ? "Active" : "Off"}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </Table>
            </>
          ) : null}

          <SectionTitle>Staff activity on this account</SectionTitle>
          <Card className="divide-y divide-ink-100">
            {detail.log.length === 0 ? (
              <p className="p-5 text-sm text-ink-500">
                Nothing yet. Anything you change here gets recorded.
              </p>
            ) : (
              detail.log.map((entry) => (
                <div key={entry.id} className="flex gap-3 p-4 text-sm">
                  <span className="shrink-0 text-xs text-ink-400">
                    <When value={entry.createdAt} withTime />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink-900">{entry.summary}</span>
                    <span className="block text-xs text-ink-400">
                      {entry.actorEmail}
                    </span>
                  </span>
                </div>
              ))
            )}
          </Card>
        </div>

        {/* --------------------------------------------------------- sidebar */}
        <aside className="min-w-0 space-y-3">
          <Card className="p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
              Account
            </h3>
            <div className="space-y-3">
              <Detail label="Owner">{owner.name}</Detail>
              <Detail label="Email">
                <a
                  href={`mailto:${owner.email}`}
                  className="text-ink-900 underline decoration-ink-300 underline-offset-2 hover:text-brand-700"
                >
                  {owner.email}
                </a>
              </Detail>
              <Detail label="Verified">
                {owner.emailVerified ? "Yes" : "No"}
              </Detail>
              <Detail label="Registered">
                <When value={owner.createdAt} withTime />
              </Detail>
              <Detail label="Shop created">
                <When value={shop.createdAt} />
              </Detail>
              <Detail label="First order">
                <When value={detail.firstOrderAt} />
              </Detail>
              <Detail label="Last order">
                <When value={detail.lastOrderAt} />
              </Detail>
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
              Subscription
            </h3>
            <div className="space-y-3">
              <Detail label="Entitled to">
                {plan.name}
                {state === "comped" ? " (comped by us)" : ""}
              </Detail>
              <Detail label="State">
                <BillingBadge shop={shop} />
              </Detail>
              <Detail label="Billing plan on Stripe">
                {shop.plan === "free" ? "Free" : shop.plan}
                {shop.subscriptionInterval
                  ? ` · ${shop.subscriptionInterval}ly`
                  : ""}
              </Detail>
              <Detail label="Stripe status">
                {shop.subscriptionStatus ?? "—"}
              </Detail>
              <Detail label="Renews">
                <When value={shop.currentPeriodEnd} />
                {shop.cancelAtPeriodEnd ? " · cancelling" : ""}
              </Detail>
              {shop.compNote ? (
                <Detail label="Comp reason">{shop.compNote}</Detail>
              ) : null}
              <Detail label="Customer">
                <StripeLink id={shop.stripeCustomerId} kind="customers" />
              </Detail>
              <Detail label="Subscription">
                <StripeLink
                  id={shop.stripeSubscriptionId}
                  kind="subscriptions"
                />
              </Detail>
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
              Card payments
            </h3>
            {shop.stripeAccountId ? (
              <div className="space-y-3">
                <Detail label="Connected account">
                  <StripeLink
                    id={shop.stripeAccountId}
                    kind="connect/accounts"
                  />
                </Detail>
                <Detail label="Charges enabled">
                  {shop.stripeChargesEnabled ? "Yes" : "Not yet"}
                </Detail>
                <Detail label="Details submitted">
                  {shop.stripeDetailsSubmitted ? "Yes" : "No"}
                </Detail>
                <Detail label="Country">
                  {shop.stripeAccountCountry ?? "—"}
                </Detail>
                <Detail label="Connected">
                  <When value={shop.stripeConnectedAt} />
                </Detail>
              </div>
            ) : (
              <p className="text-sm text-ink-500">
                No Stripe account connected — this shop settles out of band.
              </p>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
              Storefront
            </h3>
            <div className="space-y-3">
              <Detail label="Handle">
                <Mono>/{shop.handle}</Mono>
              </Detail>
              <Detail label="Currency">{shop.currency}</Detail>
              <Detail label="Language">
                {shop.locale ?? "Follows the visitor"}
              </Detail>
              <Detail label="Layout">
                {shop.theme} · {shop.layout}
              </Detail>
              <Detail label="Affiliate programme">
                {shop.affiliatesEnabled
                  ? `On · ${(shop.affiliateDefaultBp / 100).toFixed(0)}% default`
                  : "Off"}
              </Detail>
              <Detail label="Tax">
                {shop.taxEnabled
                  ? `${shop.taxName} ${(shop.taxRateBp / 100).toFixed(2)}%${shop.taxInclusive ? " inclusive" : ""}`
                  : "Off"}
              </Detail>
              <Detail label="Invoices">
                {detail.invoiceCount} issued · next {shop.invoicePrefix}-
                {String(shop.invoiceNextNumber).padStart(4, "0")}
              </Detail>
              <Detail label="Reviews">{detail.reviewCount}</Detail>
              <Detail label="Shop id">
                <Mono>{shop.id}</Mono>
              </Detail>
            </div>
          </Card>

          <AccountActions shop={shop} />
        </aside>
      </div>
    </>
  );
}
