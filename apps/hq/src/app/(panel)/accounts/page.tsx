import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@sailo/design-system/web";
import { ExportCsv } from "@/app/_components/hq-export";
import { BulkBar, BulkCheckbox } from "./_components/bulk-bar";
import { HqFilters } from "@/app/_components/hq-filters";
import { Pagination } from "@/app/_components/hq-pagination";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { BillingBadge, When } from "@/app/_components/hq-ui";
import { Badge } from "@sailo/design-system/web";
import {
  ACCOUNT_SORT_OPTIONS,
  first,
  getAccounts,
  pageNumber,
} from "@/lib/platform";
import { planFor } from "@sailo/core/plans";
import { formatMoney } from "@sailo/core/currency";
import { staffCan } from "@/lib/session";

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
}: PageProps<"/accounts">) {
  const params = await searchParams;

  const filters = {
    q: first(params.q),
    state: first(params.state),
    shopState: first(params.shopState),
    security: first(params.security),
    sort: first(params.sort),
    page: pageNumber(params.page),
  };

  /*
   * Three questions, one session lookup — `staffCan` is request-cached. They
   * are asked separately rather than rolled into one "can act" because the
   * sweep bar offers a different menu per capability, and a single flag would
   * either hide the note operation from support or offer them a suspension
   * that 403s. `data:export` is not among them: `ExportCsv` asks for itself,
   * so a new export screen inherits the rule rather than remembering it.
   */
  const [{ rows, total, page, pages }, maySuspend, mayGrant, mayNote] =
    await Promise.all([
      getAccounts(filters),
      staffCan("account:suspend"),
      staffCan("billing:grant"),
      staffCan("notes:write"),
    ]);

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Everyone who has registered — the shop they built, what it sells, and what they pay us."
        action={<ExportCsv type="accounts" />}
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

      <BulkBar may={{ suspend: maySuspend, grant: mayGrant, note: mayNote }}>
      <Table
        minWidth="66rem"
        head={
          <>
            {/*
              No "select all". A header checkbox selects the twenty-five rows on
              this page, which reads as "all accounts matching this filter" and
              is not — and the gap between those two is exactly the mistake a
              sweep must not make easy. Selecting is deliberate, one row at a
              time, which is the right amount of friction in front of a button
              that suspends a hundred businesses.
            */}
            <Th>{null}</Th>
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
          <EmptyRow colSpan={10}>
            No accounts match those filters.
          </EmptyRow>
        ) : (
          rows.map((row) => {
            const shop = row.shop;
            return (
              <Tr key={row.userId}>
                <Td>
                  {/*
                    Only a shop can be swept — every operation writes to the
                    `shops` row — so an account that never onboarded has nothing
                    to check. A disabled box would imply it might work later.
                  */}
                  {shop ? (
                    <BulkCheckbox shopId={shop.id} label={shop.name} />
                  ) : null}
                </Td>
                <Td>
                  {/*
                    `flex-col`, not `flex items-center` — see `ShopCell`. As a
                    row, the two spans rendered the name and the address as one
                    run-on string on every row of this table.
                  */}
                  <Link
                    href={`/accounts/${row.userId}`}
                    className="focus-ring flex min-w-0 flex-col items-start justify-center rounded pointer-coarse:min-h-11"
                  >
                    <span className="max-w-full truncate font-medium text-ink-900">
                      {row.name}
                    </span>
                    <span className="max-w-full truncate text-xs text-ink-400">
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
      </BulkBar>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun="accounts"
        basePath="/accounts"
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
