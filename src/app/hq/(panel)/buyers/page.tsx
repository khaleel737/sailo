import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ExportCsv } from "@/app/hq/_components/hq-export";
import { HqFilters } from "@/app/hq/_components/hq-filters";
import { Pagination } from "@/app/hq/_components/hq-pagination";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/hq/_components/hq-table";
import { ShopCell, When } from "@/app/hq/_components/hq-ui";
import { first, getPlatformBuyers, pageNumber } from "@/lib/hq";
import { formatAddress, formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Buyers" };

export default async function HqBuyersPage({
  searchParams,
}: PageProps<"/hq/buyers">) {
  const params = await searchParams;

  const filters = {
    q: first(params.q),
    page: pageNumber(params.page),
  };

  const { rows, total, page, pages } = await getPlatformBuyers(filters);

  return (
    <>
      <PageHeader
        title="Buyers"
        description="Our clients' customers — everyone who has ordered from a Sailo shop, biggest spenders first."
        action={
          <ExportCsv type="buyers" />
        }
      />

      <HqFilters
        values={{ q: filters.q }}
        placeholder="Search buyer name, email, phone or shop…"
      />

      <Table
        head={
          <>
            <Th>Buyer</Th>
            <Th>Bought from</Th>
            <Th>Where</Th>
            <Th align="end">Orders</Th>
            <Th align="end">Spent</Th>
            <Th align="end">Last order</Th>
            <Th align="end">First seen</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={7}>No buyers match that search.</EmptyRow>
        ) : (
          rows.map((row) => (
            <Tr key={row.client.id}>
              <Td className="max-w-56">
                <span className="block truncate text-ink-900">
                  {row.client.name}
                </span>
                <span className="block truncate text-xs text-ink-400">
                  {[row.client.email, row.client.phone]
                    .filter(Boolean)
                    .join(" · ") || "No contact details"}
                </span>
              </Td>
              <Td className="max-w-44" label="Bought from">
                <ShopCell
                  ownerId={row.ownerId}
                  name={row.shopName}
                  handle={row.shopHandle}
                />
              </Td>
              <Td className="max-w-52" label="Where">
                <span className="block truncate text-xs text-ink-500">
                  {formatAddress(row.client) || "—"}
                </span>
              </Td>
              <Td align="end" className="tabular" label="Orders">
                {row.orderCount.toLocaleString()}
              </Td>
              <Td align="end" className="tabular whitespace-nowrap" label="Spent">
                {formatMoney(row.spentCents, row.currency)}
              </Td>
              <Td align="end" className="text-ink-500" label="Last order">
                <When value={row.lastOrderAt} />
              </Td>
              <Td align="end" className="text-ink-500" label="First seen">
                <When value={row.client.createdAt} />
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun="buyers"
        basePath="/hq/buyers"
        params={{ q: filters.q }}
      />

      <p className="mt-6 text-xs leading-relaxed text-ink-400">
        These people are our sellers&rsquo; customers, not ours. They have no
        Sailo account and never see us — a buyer belongs to the one shop they
        ordered from, and the same person shopping at two shops is two rows.
      </p>
    </>
  );
}
