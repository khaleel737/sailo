import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Badge } from "@sailo/design-system/web";
import { HqFilters } from "@/app/_components/hq-filters";
import { Pagination } from "@/app/_components/hq-pagination";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { ExportCsv } from "@/app/_components/hq-export";
import { When } from "@/app/_components/hq-ui";
import { first, hqSubscribers, pageNumber } from "@/lib/platform";
import { NEWSLETTER_SOURCES } from "@sailo/marketing/newsletter";

export const metadata: Metadata = { title: "Subscribers" };

/**
 * Everyone on Sailo's own list.
 *
 * Wider than "who can be mailed", deliberately. A subscriber who unsubscribed
 * is still on this screen with the reason showing, because they are the
 * difference between "4,100 joined" and "reach 3,890" — and a list that
 * silently hides the gap turns it into a bug report.
 *
 * The two columns that make this more than an address book are `From` and
 * `Account`. The first says which page won them, which is the only signal the
 * blog can be steered by; the second says whether they went on to sign up,
 * which is the only measure of whether any of it worked.
 */
const SOURCE_FILTER = {
  name: "source",
  label: "Source",
  options: [
    { value: "all", label: "Any source" },
    ...NEWSLETTER_SOURCES.map((source) => ({ value: source, label: source })),
  ],
};

const STATE_FILTER = {
  name: "state",
  label: "State",
  options: [
    { value: "all", label: "Everyone" },
    { value: "mailable", label: "Reachable" },
    { value: "left", label: "Left or bounced" },
  ],
};

/** How a reason reads at a glance. Red for the two that cannot be undone. */
const REASON_TONE = {
  unsubscribed: "neutral",
  bounced: "red",
  complained: "red",
} as const;

export default async function HqSubscribersPage({
  searchParams,
}: PageProps<"/marketing/subscribers">) {
  const params = await searchParams;

  const filters = {
    q: first(params.q),
    source: first(params.source),
    state: first(params.state),
    page: pageNumber(params.page),
  };

  const { rows, total, page, pages } = await hqSubscribers(filters);

  return (
    <>
      <PageHeader
        title="Subscribers"
        description="People who asked to hear from Sailo — every one of them confirmed by clicking a link sent to their own address."
        action={<ExportCsv type="subscribers" />}
      />

      <HqFilters
        values={{ q: filters.q, source: filters.source, state: filters.state }}
        fields={[SOURCE_FILTER, STATE_FILTER]}
        placeholder="Search name or address…"
      />

      <Table
        head={
          <>
            <Th>Subscriber</Th>
            <Th>From</Th>
            <Th>Language</Th>
            <Th>Account</Th>
            <Th>State</Th>
            <Th align="end">Joined</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={6}>Nobody matches that search.</EmptyRow>
        ) : (
          rows.map((row) => (
            <Tr key={row.id}>
              <Td className="max-w-64">
                <span className="block truncate text-ink-900">{row.email}</span>
                {row.name ? (
                  <span className="block truncate text-xs text-ink-400">
                    {row.name}
                  </span>
                ) : null}
              </Td>
              <Td className="max-w-56" label="From">
                {row.sourcePath ? (
                  <Link
                    href={row.sourcePath}
                    className="focus-ring block truncate rounded text-xs text-ink-600 hover:underline"
                  >
                    {row.sourcePath}
                  </Link>
                ) : (
                  <span className="block truncate text-xs text-ink-400">
                    {row.source}
                  </span>
                )}
              </Td>
              <Td label="Language">
                <span className="text-xs uppercase text-ink-500">{row.locale}</span>
              </Td>
              <Td className="max-w-40" label="Account">
                {/*
                  A shop handle is the useful answer here, not a yes. It links
                  straight to the account page, which is what somebody looking
                  at a converted subscriber actually wants next.
                */}
                {row.shopHandle ? (
                  <Link
                    href={`/accounts?q=${encodeURIComponent(row.email)}`}
                    className="focus-ring block truncate rounded text-xs text-ink-900 hover:underline"
                  >
                    /{row.shopHandle}
                  </Link>
                ) : row.hasAccount ? (
                  <span className="text-xs text-ink-500">Signed up</span>
                ) : (
                  <span className="text-xs text-ink-300">—</span>
                )}
              </Td>
              <Td label="State">
                {row.optedOutReason ? (
                  <Badge
                    tone={
                      REASON_TONE[
                        row.optedOutReason as keyof typeof REASON_TONE
                      ] ?? "neutral"
                    }
                  >
                    {row.optedOutReason}
                  </Badge>
                ) : (
                  <Badge tone="green">Reachable</Badge>
                )}
              </Td>
              <Td align="end" className="text-ink-500" label="Joined">
                <When value={row.confirmedAt} />
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun="subscribers"
        basePath="/marketing/subscribers"
        params={{ q: filters.q, source: filters.source, state: filters.state }}
      />

      <p className="mt-6 text-xs leading-relaxed text-ink-400">
        There is no way to add somebody here by hand, and that is deliberate: a
        row exists only once a link sent to that address has been clicked. An
        imported list is how a sending domain gets blocked, and this domain also
        carries every seller&rsquo;s order confirmations.
      </p>
    </>
  );
}
