import type { Metadata } from "next";
import { PageHeader } from "@sailo/design-system/web";
import { ExportCsv } from "@/app/_components/hq-export";
import { HqFilters } from "@/app/_components/hq-filters";
import { Pagination } from "@/app/_components/hq-pagination";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { Mono, ShopCell } from "@/app/_components/hq-ui";
import { Badge } from "@sailo/design-system/web";
import { first, getPlatformAffiliates, pageNumber } from "@/lib/platform";
import { formatMoney } from "@sailo/core/currency";

export const metadata: Metadata = { title: "Affiliates" };

const STATUS_TONE = {
  active: "green",
  pending: "amber",
  disabled: "neutral",
} as const;

const SOURCE_LABELS: Record<string, string> = {
  manual: "Added by the seller",
  signup: "Applied on the shop",
  buyer: "Refer and earn",
};

export default async function HqAffiliatesPage({
  searchParams,
}: PageProps<"/affiliates">) {
  const params = await searchParams;

  const filters = {
    q: first(params.q),
    status: first(params.status),
    page: pageNumber(params.page),
  };

  const { rows, total, page, pages } = await getPlatformAffiliates(filters);

  return (
    <>
      <PageHeader
        title="Affiliates"
        description="Everyone earning commission on a Sailo shop, and what they've been paid."
        action={
          <ExportCsv type="affiliates" />
        }
      />

      <HqFilters
        values={{ q: filters.q, status: filters.status }}
        placeholder="Search affiliate, code or shop…"
        fields={[
          {
            name: "status",
            label: "Status",
            options: [
              { value: "all", label: "Any status" },
              { value: "active", label: "Active" },
              { value: "pending", label: "Pending" },
              { value: "disabled", label: "Disabled" },
            ],
          },
        ]}
      />

      <Table
        minWidth="64rem"
        head={
          <>
            <Th>Affiliate</Th>
            <Th>Shop</Th>
            <Th>Code</Th>
            <Th>Source</Th>
            <Th align="end">Clicks</Th>
            <Th align="end">Orders</Th>
            <Th align="end">Sales</Th>
            <Th align="end">Earned</Th>
            <Th align="end">Unpaid</Th>
            <Th>Status</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={10}>No affiliates match those filters.</EmptyRow>
        ) : (
          rows.map((row) => (
            <Tr key={row.affiliate.id}>
              <Td className="max-w-48">
                <span className="block truncate text-ink-900">
                  {row.affiliate.name}
                </span>
                {row.affiliate.email ? (
                  <span className="block truncate text-xs text-ink-400">
                    {row.affiliate.email}
                  </span>
                ) : null}
              </Td>
              <Td className="max-w-44" label="Shop">
                <ShopCell
                  ownerId={row.ownerId}
                  name={row.shopName}
                  handle={row.shopHandle}
                />
              </Td>
              <Td label="Code">
                <Mono>{row.affiliate.code}</Mono>
              </Td>
              <Td className="text-xs text-ink-500" label="Source">
                {SOURCE_LABELS[row.affiliate.source] ?? row.affiliate.source}
              </Td>
              <Td align="end" className="tabular" label="Clicks">
                {row.affiliate.clicks.toLocaleString()}
              </Td>
              <Td align="end" className="tabular" label="Orders">
                {row.orderCount.toLocaleString()}
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Sales">
                {formatMoney(row.salesCents, row.currency)}
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Earned">
                {formatMoney(row.earnedCents, row.currency)}
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Unpaid">
                {row.unpaidCents > 0 ? (
                  <span className="font-medium text-amber-700">
                    {formatMoney(row.unpaidCents, row.currency)}
                  </span>
                ) : (
                  <span className="text-ink-400">—</span>
                )}
              </Td>
              <Td label="Status">
                <Badge
                  tone={
                    STATUS_TONE[
                      row.affiliate.status as keyof typeof STATUS_TONE
                    ] ?? "neutral"
                  }
                >
                  {row.affiliate.status}
                </Badge>
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun="affiliates"
        basePath="/affiliates"
        params={{ q: filters.q, status: filters.status }}
      />

      <p className="mt-6 text-xs leading-relaxed text-ink-400">
        Commission is owed by the seller to their affiliate, not by Sailo.
        Unpaid totals are what a seller still has to settle — useful when they
        write in asking why an affiliate is chasing them.
      </p>
    </>
  );
}
