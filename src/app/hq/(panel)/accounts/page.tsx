import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { ExportCsv } from "@/app/hq/_components/hq-export";
import { HqFilters } from "@/app/hq/_components/hq-filters";
import { Pagination } from "@/app/hq/_components/hq-pagination";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/hq/_components/hq-table";
import { BillingBadge, When } from "@/app/hq/_components/hq-ui";
import { Badge } from "@/components/ui";
import {
  ACCOUNT_SORT_OPTIONS,
  first,
  getAccounts,
  pageNumber,
} from "@/lib/hq";
import { planFor } from "@/lib/plans";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Accounts" };

const STATE_OPTIONS = [
  { value: "all", label: "Any billing" },
  { value: "paying", label: "Paying" },
  { value: "trialing", label: "Trialing" },
  { value: "past_due", label: "Past due" },
  { value: "canceled", label: "Canceled" },
  { value: "comped", label: "Comped" },
  { value: "free", label: "Free" },
];

const SHOP_OPTIONS = [
  { value: "all", label: "Any account" },
  { value: "onboarded", label: "Has a shop" },
  { value: "none", label: "Never onboarded" },
  { value: "live", label: "Shop is live" },
  { value: "unpublished", label: "Unpublished" },
  { value: "suspended", label: "Suspended" },
  { value: "connected", label: "Takes cards" },
];

export default async function HqAccountsPage({
  searchParams,
}: PageProps<"/hq/accounts">) {
  const params = await searchParams;

  const filters = {
    q: first(params.q),
    state: first(params.state),
    shopState: first(params.shopState),
    sort: first(params.sort),
    page: pageNumber(params.page),
  };

  const { rows, total, page, pages } = await getAccounts(filters);

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Everyone who has registered — the shop they built, what it sells, and what they pay us."
        action={
          <ExportCsv type="accounts" />
        }
      />

      <HqFilters
        values={{
          q: filters.q,
          state: filters.state,
          shopState: filters.shopState,
          sort: filters.sort,
        }}
        placeholder="Search name, email, shop or handle…"
        fields={[
          { name: "state", label: "Billing", options: STATE_OPTIONS },
          { name: "shopState", label: "Account", options: SHOP_OPTIONS },
          {
            name: "sort",
            label: "Sort",
            options: ACCOUNT_SORT_OPTIONS.map((o) => ({ ...o })),
          },
        ]}
      />

      <Table
        head={
          <>
            <Th>Account</Th>
            <Th>Shop</Th>
            <Th>Plan</Th>
            <Th align="end">Products</Th>
            <Th align="end">Orders</Th>
            <Th align="end">Volume</Th>
            <Th align="end">Last order</Th>
            <Th align="end">Joined</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={8}>
            No accounts match those filters.
          </EmptyRow>
        ) : (
          rows.map((row) => {
            const shop = row.shop;
            return (
              <Tr key={row.userId}>
                <Td>
                  <Link
                    href={`/hq/accounts/${row.userId}`}
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
                  {shop ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-ink-900">
                          {shop.name}
                        </span>
                        <span className="block truncate text-xs text-ink-400">
                          /{shop.handle}
                        </span>
                      </span>
                      {shop.suspendedAt ? (
                        <Badge tone="red">Suspended</Badge>
                      ) : !shop.isPublished ? (
                        <Badge tone="neutral">Hidden</Badge>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-ink-400">Never onboarded</span>
                  )}
                </Td>

                <Td label="Plan">
                  {shop ? (
                    <BillingBadge shop={shop} plan={planFor(shop).name} />
                  ) : null}
                </Td>

                <Td align="end" className="tabular" label="Products">
                  {row.productCount.toLocaleString()}
                </Td>
                <Td align="end" className="tabular" label="Orders">
                  {row.orderCount.toLocaleString()}
                </Td>
                <Td align="end" className="tabular whitespace-nowrap" label="Volume">
                  {formatMoney(row.gmvCents, shop?.currency ?? "USD")}
                </Td>
                <Td align="end" className="text-ink-500" label="Last order">
                  <When value={row.lastOrderAt} />
                </Td>
                <Td align="end" className="text-ink-500" label="Joined">
                  <When value={row.joinedAt} />
                </Td>
              </Tr>
            );
          })
        )}
      </Table>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun="accounts"
        basePath="/hq/accounts"
        params={{
          q: filters.q,
          state: filters.state,
          shopState: filters.shopState,
          sort: filters.sort,
        }}
      />
    </>
  );
}
