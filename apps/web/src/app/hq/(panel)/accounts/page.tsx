import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@sailo/design-system/web";
import { ExportCsv } from "@/app/hq/_components/hq-export";
import { HqFilters } from "@/app/hq/_components/hq-filters";
import { Pagination } from "@/app/hq/_components/hq-pagination";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/hq/_components/hq-table";
import { BillingBadge, When } from "@/app/hq/_components/hq-ui";
import { Badge } from "@sailo/design-system/web";
import {
  ACCOUNT_SORT_OPTIONS,
  first,
  getAccounts,
  pageNumber,
} from "@/lib/hq";
import { planFor } from "@sailo/core/plans";
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
  // Self-deleted accounts. The row survives to hold the invoice sequence, so
  // they are still findable here — and only here.
  { value: "deleted", label: "Deleted" },
  { value: "connected", label: "Takes cards" },
];

/*
 * What guards the account, as a filter.
 *
 * "Takes cards, no 2FA" leads because it is the only one of these that is a
 * job: money moves through those shops, and a single password is what stands
 * between it and whoever buys the seller's email address in a breach dump.
 */
const SECURITY_OPTIONS = [
  { value: "all", label: "Any security" },
  { value: "cards_no2fa", label: "Takes cards, no 2FA" },
  { value: "no2fa", label: "No two-factor" },
  { value: "twofactor", label: "Two-factor on" },
  { value: "unverified", label: "Email unverified" },
];

export default async function HqAccountsPage({
  searchParams,
}: PageProps<"/hq/accounts">) {
  const params = await searchParams;

  const filters = {
    q: first(params.q),
    state: first(params.state),
    shopState: first(params.shopState),
    security: first(params.security),
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
          security: filters.security,
          sort: filters.sort,
        }}
        placeholder="Search name, email, shop or handle…"
        fields={[
          { name: "state", label: "Billing", options: STATE_OPTIONS },
          { name: "shopState", label: "Account", options: SHOP_OPTIONS },
          { name: "security", label: "Security", options: SECURITY_OPTIONS },
          {
            name: "sort",
            label: "Sort",
            options: ACCOUNT_SORT_OPTIONS.map((o) => ({ ...o })),
          },
        ]}
      />

      <Table
        minWidth="64rem"
        head={
          <>
            <Th>Account</Th>
            <Th>Shop</Th>
            <Th>Plan</Th>
            <Th>Guards</Th>
            <Th align="end">Products</Th>
            <Th align="end">Orders</Th>
            <Th align="end">Volume</Th>
            <Th align="end">Last order</Th>
            <Th align="end">Joined</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={9}>
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
                      {/* Deletion outranks the rest: a tombstone is
                          unpublished too, and "Hidden" would understate it. */}
                      {shop.deletedAt ? (
                        <Badge tone="neutral">Deleted</Badge>
                      ) : shop.suspendedAt ? (
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

                {/*
                  Only what is missing gets a chip. A green "2FA on" beside a
                  green "Verified" on every healthy row is forty badges to read
                  past before the one row that matters — so the healthy state is
                  the absence of a badge, and a clean column means a clean list.
                */}
                <Td label="Guards">
                  <span className="flex flex-wrap gap-1.5">
                    {row.twoFactorEnabled ? null : (
                      <Badge
                        tone={shop?.stripeChargesEnabled ? "red" : "amber"}
                        title={
                          shop?.stripeChargesEnabled
                            ? "Takes card payments behind a password alone"
                            : "No second factor on this account"
                        }
                      >
                        No 2FA
                      </Badge>
                    )}
                    {row.emailVerified ? null : (
                      <Badge tone="amber">Unverified</Badge>
                    )}
                    {row.twoFactorEnabled && row.emailVerified ? (
                      <span className="text-xs text-ink-400">—</span>
                    ) : null}
                  </span>
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
          security: filters.security,
          sort: filters.sort,
        }}
      />
    </>
  );
}
