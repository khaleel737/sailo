import type { Metadata } from "next";
import { PageHeader } from "@sailo/design-system/web";
import { HqFilters } from "@/app/hq/_components/hq-filters";
import { Pagination } from "@/app/hq/_components/hq-pagination";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/hq/_components/hq-table";
import { ShopCell } from "@/app/hq/_components/hq-ui";
import { Badge, Button } from "@sailo/design-system/web";
import { closeSupportTicket } from "@/lib/actions/hq";
import { first, getSupportTickets, pageNumber } from "@/lib/hq";
import { SUPPORT_TOPIC_LABELS, isSupportTopic } from "@sailo/core/support";

export const metadata: Metadata = { title: "Support" };

const date = (value: Date | string) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default async function HqSupportPage({
  searchParams,
}: PageProps<"/hq/support">) {
  const params = await searchParams;

  const filters = {
    q: first(params.q),
    status: first(params.status),
    page: pageNumber(params.page),
  };

  const { rows, total, page, pages } = await getSupportTickets(filters);

  return (
    <>
      <PageHeader
        title="Support"
        description="Tickets sellers filed from their admin. Each one also landed in the support inbox with the seller in CC — answer there, close here."
      />

      <HqFilters
        values={{ q: filters.q, status: filters.status }}
        placeholder="Search subject, shop or email…"
        fields={[
          {
            name: "status",
            label: "Status",
            options: [
              { value: "all", label: "Any status" },
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
            ],
          },
        ]}
      />

      <Table
        minWidth="72rem"
        head={
          <>
            <Th>Ticket</Th>
            <Th>Shop</Th>
            <Th>Topic</Th>
            <Th>From</Th>
            <Th>Screenshots</Th>
            <Th>Opened</Th>
            <Th>Status</Th>
            <Th>
              <span className="sr-only">Close</span>
            </Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={8}>No tickets match those filters.</EmptyRow>
        ) : (
          rows.map((row) => (
            <Tr key={row.ticket.id}>
              <Td className="max-w-md">
                <span dir="auto" className="block truncate font-medium text-ink-900">
                  {row.ticket.subject}
                </span>
                <span
                  dir="auto"
                  title={row.ticket.message}
                  className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-ink-500"
                >
                  {row.ticket.message}
                </span>
              </Td>
              <Td className="max-w-44" label="Shop">
                <ShopCell
                  ownerId={row.ownerId}
                  name={row.shopName}
                  handle={row.shopHandle}
                />
              </Td>
              <Td className="text-xs text-ink-500" label="Topic">
                {isSupportTopic(row.ticket.topic)
                  ? SUPPORT_TOPIC_LABELS[row.ticket.topic]
                  : row.ticket.topic}
              </Td>
              <Td className="max-w-44" label="From">
                <span className="block truncate text-xs text-ink-500">
                  {row.ticket.email}
                </span>
              </Td>
              <Td label="Screenshots">
                {row.ticket.imageUrls.length === 0 ? (
                  <span className="text-ink-400">—</span>
                ) : (
                  <span className="flex gap-1.5">
                    {row.ticket.imageUrls.map((url, i) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium underline underline-offset-2 hover:text-ink-900"
                      >
                        {i + 1}
                      </a>
                    ))}
                  </span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-xs text-ink-500" label="Opened">
                {date(row.ticket.createdAt)}
              </Td>
              <Td label="Status">
                <Badge tone={row.ticket.status === "open" ? "amber" : "green"} dot>
                  {row.ticket.status}
                </Badge>
              </Td>
              <Td align="end">
                {row.ticket.status === "open" ? (
                  <form action={closeSupportTicket}>
                    <input type="hidden" name="id" value={row.ticket.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      Close
                    </Button>
                  </form>
                ) : row.ticket.closedAt ? (
                  <span className="whitespace-nowrap text-xs text-ink-400">
                    {date(row.ticket.closedAt)}
                  </span>
                ) : null}
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun="tickets"
        basePath="/hq/support"
        params={{ q: filters.q, status: filters.status }}
      />
    </>
  );
}
