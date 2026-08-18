import Link from "next/link";
import { Badge, Table, Td, Th, Tr } from "@sailo/design-system/web";
import {
  ANONYMOUS_CONTACT,
  type SubscriberRow,
  type SuppressionReason,
} from "@sailo/marketing/broadcasts/server";
import type { AdminDictionary } from "@sailo/i18n/admin/en";

/**
 * The list, as people rather than as a number.
 *
 * One table, rendered both as a preview on the broadcasts screen and in full
 * on its own page, because a seller who clicks through from "12 joined" must
 * not land on something that presents the same rows differently and make them
 * wonder which one is right.
 *
 * Everyone who ever opted in is here, including the people who have since
 * unsubscribed or bounced. Filtering them out would leave the seller with a
 * list that is quietly shorter than the number above it, and no way to find
 * out why — which is exactly the question the status column answers.
 */

type Status = { tone: "green" | "neutral" | "amber" | "red"; label: string };

/*
 * Suppression reason → what the badge says and how loudly.
 *
 * Written as whole dictionary reads rather than as keys held in a lookup,
 * which is how the rest of the admin writes these: `admin-coverage` scans the
 * source for exactly that shape, and a dictionary entry it cannot see is one
 * it reports as a translation nobody shows.
 */
const STATUS = (
  a: AdminDictionary,
): Record<"none" | SuppressionReason, Status> => ({
  none: { tone: "green", label: a.broadcasts.subscriberActive },
  unsubscribed: { tone: "neutral", label: a.broadcasts.subscriberUnsubscribed },
  bounced: { tone: "amber", label: a.broadcasts.subscriberBounced },
  complained: { tone: "red", label: a.broadcasts.subscriberComplained },
});

/** The same four words the segment builder uses for the same four sources. */
const SOURCE_LABEL = (a: AdminDictionary): Record<string, string> => ({
  order: a.broadcasts.sourceOrder,
  subscribe: a.broadcasts.sourceSubscribe,
  manual: a.broadcasts.sourceManual,
  import: a.broadcasts.sourceImport,
});

export function SubscriberList({
  rows,
  a,
  locale,
}: {
  rows: SubscriberRow[];
  a: AdminDictionary;
  locale: string;
}) {
  const statuses = STATUS(a);
  const sources = SOURCE_LABEL(a);

  return (
    <Table
      minWidth="40rem"
      head={
        <>
          <Th>{a.columns.client}</Th>
          <Th>{a.broadcasts.joinedVia}</Th>
          <Th>{a.broadcasts.joinedOn}</Th>
          <Th align="end">{a.columns.status}</Th>
        </>
      }
    >
      {rows.map((row) => {
        /* A total record over "none" plus every suppression reason, so the
           lookup needs no fallback and a new reason is a type error here
           rather than a blank badge in production. */
        const status = statuses[row.suppressedReason ?? "none"];
        /* The address is the identity on this screen, so it leads. The name
           is what a broadcast greets them by, and half of them will not have
           given one — `ANONYMOUS_CONTACT` is what a checkout writes when it
           had no name to write, and printing it back at the seller as if it
           were somebody's name is worse than saying there isn't one. */
        const named = row.name && row.name !== ANONYMOUS_CONTACT;

        return (
          <Tr key={row.clientId}>
            <Td>
              <Link
                href={`/admin/clients/${row.clientId}`}
                className="focus-ring flex min-w-0 flex-col rounded pointer-coarse:min-h-11"
              >
                <span className="truncate font-medium text-ink-900">
                  {row.email}
                </span>
                <span className="truncate text-xs text-ink-400">
                  {named ? row.name : a.broadcasts.noName}
                </span>
              </Link>
            </Td>

            <Td label={a.broadcasts.joinedVia}>
              <span className="text-xs text-ink-500">
                {sources[row.source] ?? row.source}
              </span>
            </Td>

            <Td label={a.broadcasts.joinedOn}>
              <span className="text-xs text-ink-500">
                {row.consentedAt.toLocaleDateString(locale, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </Td>

            <Td align="end" label={a.columns.status}>
              <Badge tone={status.tone}>{status.label}</Badge>
            </Td>
          </Tr>
        );
      })}
    </Table>
  );
}
