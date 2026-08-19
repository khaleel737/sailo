import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CreditCard,
  Eye,
  Gift,
  Package,
  ShoppingBag,
  Users,
  Wallet,
} from "lucide-react";
import { Card } from "@sailo/design-system/web";
import { Chart } from "@sailo/design-system/web/chart";
import { AccountActions } from "./_components/account-actions";
import { Detail, Metric, MetricRow, Mono, SectionTitle, When } from "@/app/_components/hq-ui";
import { getAccountHeader, getAccountOverview } from "@/lib/platform";
import { staffCan } from "@/lib/session";
import { formatMoney } from "@sailo/core/currency";

export async function generateMetadata({
  params,
}: PageProps<"/accounts/[id]">): Promise<Metadata> {
  const { id } = await params;
  const header = await getAccountHeader(id);
  if (!header) return { title: "Account" };
  return { title: header.shop?.name ?? header.owner.name };
}

/**
 * The overview tab: is this shop working, and what have we done to it.
 *
 * Four reads — the thirty-day stats, two chart series and the staff log — where
 * the page this replaced fired thirteen before it drew anything. The rest moved
 * to the tabs that own it, which is the whole argument in `getAccountHeader`'s
 * note.
 *
 * The staff log is here rather than on a tab of its own because "what have we
 * already done about this" is the question somebody is holding when they
 * arrive, and a click away is far enough to make a decision without it.
 */
export default async function HqAccountOverviewPage({
  params,
}: PageProps<"/accounts/[id]">) {
  const { id } = await params;
  const header = await getAccountHeader(id);
  if (!header) notFound();

  const { owner, shop } = header;

  /*
   * An account that registered and stopped. Worth its own screen — this is the
   * shape of the biggest leak in any signup funnel — and it has no tabs above
   * it, because four of the five would be empty by definition.
   */
  if (!shop) {
    return (
      <>
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

        {/*
          No shop is not no account: they can still be signed in, still be
          locked out of their authenticator, and still be the person on the
          other end of a support mail about either. The security tab handles
          both cases, so this is a link rather than a second copy of it.
        */}
        <p className="mt-4 text-sm text-ink-500">
          They can still hold sessions and a second factor —{" "}
          <a
            href={`/accounts/${owner.id}/security`}
            className="text-ink-900 underline decoration-ink-300 underline-offset-2 hover:text-brand-700"
          >
            see what guards this account
          </a>
          .
        </p>
      </>
    );
  }

  /*
   * One question per capability, not one for the column. The four cards in
   * `AccountActions` sit behind three different grants, and asking once for the
   * loudest of them would hide the internal note — which every role holds and
   * which is the main thing support does on this screen.
   *
   * All three are request-cached, so this is one session lookup.
   */
  const [overview, mayGrant, maySuspend, mayNote] = await Promise.all([
    getAccountOverview(shop.id),
    staffCan("billing:grant"),
    staffCan("account:suspend"),
    staffCan("notes:write"),
  ]);

  const money = (cents: number) => formatMoney(cents, shop.currency);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <MetricRow>
          <Metric
            icon={<Wallet className="size-4" />}
            label="Net revenue"
            value={money(overview.stats.netRevenueCents)}
            hint={
              overview.stats.refundedCents > 0
                ? `${money(overview.stats.refundedCents)} refunded`
                : undefined
            }
          />
          <Metric
            icon={<ShoppingBag className="size-4" />}
            label="Orders"
            value={overview.stats.totalOrders.toLocaleString()}
            hint={
              overview.stats.newOrders > 0
                ? `${overview.stats.newOrders} not yet actioned`
                : undefined
            }
          />
          <Metric
            icon={<Package className="size-4" />}
            label="Products"
            value={overview.stats.totalProducts.toLocaleString()}
            hint={`${overview.stats.publishedProducts} published`}
          />
          <Metric
            icon={<Eye className="size-4" />}
            label="Visits · 30d"
            value={overview.stats.visitsInRange.toLocaleString()}
            hint={`${overview.stats.uniqueVisitorsInRange} unique`}
          />
        </MetricRow>

        <div className="mt-3">
          <MetricRow>
            <Metric
              icon={<CreditCard className="size-4" />}
              label="Paid orders"
              value={money(overview.stats.paidValueCents)}
              hint={
                overview.stats.awaitingConfirmation > 0
                  ? `${overview.stats.awaitingConfirmation} awaiting confirmation`
                  : undefined
              }
            />
            <Metric
              icon={<Gift className="size-4" />}
              label="Commission owed"
              value={money(overview.stats.unpaidCommissionCents)}
              hint="To this shop's own affiliates"
            />
            <Metric
              icon={<Users className="size-4" />}
              label="Tax collected"
              value={money(overview.stats.taxCollectedCents)}
              hint={
                shop.taxEnabled
                  ? `${shop.taxName} at ${(shop.taxRateBp / 100).toFixed(2)}%`
                  : "Tax is off"
              }
            />
            <Metric
              icon={<Wallet className="size-4" />}
              label="Currency"
              value={shop.currency}
              hint={shop.locale ?? "Follows the visitor"}
            />
          </MetricRow>
        </div>

        <div className="mt-4 grid items-start gap-3 sm:grid-cols-2">
          <Card className="p-5">
            <Chart
              title="Visits · 30 days"
              defaultShape="line"
              days={overview.visitSeries.map((d) => d.day)}
              series={[
                {
                  key: "visits",
                  label: "Views",
                  values: overview.visitSeries.map((d) => d.count),
                },
                {
                  key: "unique",
                  label: "Visitors",
                  values: overview.visitSeries.map((d) => d.unique),
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
              days={overview.revenueSeries.map((d) => d.day)}
              series={[
                {
                  key: "sales",
                  label: "Sales",
                  depth: 1,
                  values: overview.revenueSeries.map((d) => d.grossCents),
                },
                {
                  key: "refunds",
                  label: "Refunds",
                  negative: true,
                  depth: 2,
                  values: overview.revenueSeries.map((d) => d.refundedCents),
                },
                {
                  key: "net",
                  label: "Net",
                  depth: 0,
                  readoutOnly: true,
                  values: overview.revenueSeries.map((d) => d.cents),
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

        <SectionTitle>Staff activity on this account</SectionTitle>
        <Card className="divide-y divide-ink-100">
          {overview.log.length === 0 ? (
            <p className="p-5 text-sm text-ink-500">
              Nothing yet. Anything you change here gets recorded.
            </p>
          ) : (
            overview.log.map((entry) => (
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
            <Detail label="Verified">{owner.emailVerified ? "Yes" : "No"}</Detail>
            <Detail label="Registered">
              <When value={owner.createdAt} withTime />
            </Detail>
            <Detail label="Shop created">
              <When value={shop.createdAt} />
            </Detail>
            <Detail label="Handle">
              <Mono>/{shop.handle}</Mono>
            </Detail>
            <Detail label="Shop id">
              <Mono>{shop.id}</Mono>
            </Detail>
          </div>
        </Card>

        <AccountActions
          shop={shop}
          may={{ grant: mayGrant, suspend: maySuspend, note: mayNote }}
        />

        {!mayGrant && !maySuspend ? (
          <Card className="p-4">
            <p className="text-xs leading-relaxed text-ink-500">
              Comping a plan and suspending a shop need a role you don&rsquo;t
              hold. Everything on this account is readable, and the internal note
              above is yours to write.
            </p>
          </Card>
        ) : null}
      </aside>
    </div>
  );
}
