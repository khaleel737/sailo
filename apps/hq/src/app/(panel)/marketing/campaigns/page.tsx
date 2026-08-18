import type { Metadata } from "next";
import Link from "next/link";
import { Send } from "lucide-react";
import { Button, PageHeader } from "@sailo/design-system/web";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { Pagination } from "@/app/_components/hq-pagination";
import { When } from "@/app/_components/hq-ui";
import { hqCampaigns, pageNumber } from "@/lib/platform";
import { NEWSLETTER_AUDIENCE_LABELS } from "@sailo/marketing/newsletter";
import { CampaignStatus } from "../_components/status-badge";

export const metadata: Metadata = { title: "Campaigns" };

/**
 * Every campaign Sailo has written to its own list.
 *
 * The `Sent` column is two numbers on purpose. A campaign that is mid-flight
 * reads "412 / 900", which is the honest state — one number would either claim
 * it had finished or hide that it had started, and the difference matters most
 * exactly when somebody is watching a send they just began.
 */
export default async function HqCampaignsPage({
  searchParams,
}: PageProps<"/marketing/campaigns">) {
  const params = await searchParams;
  const { rows, total, page, pages } = await hqCampaigns(pageNumber(params.page));

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="What we have written to the list, and what is booked to go."
        action={
          <Link href="/marketing/campaigns/new">
            <Button size="sm">
              <Send className="size-4" />
              New campaign
            </Button>
          </Link>
        }
      />

      <Table
        head={
          <>
            <Th>Subject</Th>
            <Th>Audience</Th>
            <Th>Status</Th>
            <Th align="end">Sent</Th>
            <Th align="end">When</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={5}>
            Nothing written yet. The first one is the hardest.
          </EmptyRow>
        ) : (
          rows.map((row) => (
            <Tr key={row.id}>
              <Td className="max-w-80">
                <Link
                  href={`/marketing/campaigns/${row.id}`}
                  className="focus-ring block truncate rounded text-ink-900 hover:underline"
                >
                  {row.subject}
                </Link>
                {row.previewText ? (
                  <span className="block truncate text-xs text-ink-400">
                    {row.previewText}
                  </span>
                ) : null}
              </Td>
              <Td label="Audience">
                <span className="text-xs text-ink-500">
                  {NEWSLETTER_AUDIENCE_LABELS[
                    row.audience as keyof typeof NEWSLETTER_AUDIENCE_LABELS
                  ]?.label ?? row.audience}
                </span>
              </Td>
              <Td label="Status">
                <CampaignStatus status={row.status} />
              </Td>
              <Td align="end" className="tabular" label="Sent">
                {row.recipientCount > 0
                  ? `${row.delivered.toLocaleString()} / ${row.recipientCount.toLocaleString()}`
                  : "—"}
              </Td>
              <Td align="end" className="text-ink-500" label="When">
                {/*
                  Whichever of the three timestamps is the answer to "when",
                  in the order a reader means it: gone, booked, written.
                */}
                <When value={row.sentAt ?? row.scheduledAt ?? row.createdAt} />
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun="campaigns"
        basePath="/marketing/campaigns"
        params={{}}
      />
    </>
  );
}
