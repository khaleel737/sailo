import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import {
  SUPPRESSION_LIMIT,
  suppressionCounts,
  suppressionsFor,
} from "@sailo/marketing/contacts/server";
import {
  Alert,
  Badge,
  EmptyState,
  LocalTime,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
  Tr,
} from "@sailo/design-system/web";
import { interpolate } from "@sailo/i18n";
import { Resubscribe } from "./_components/resubscribe";

export const metadata: Metadata = { title: "Unsubscribed" };

export const instant = false;

/**
 * The window onto `email_suppressions`, which was a correct model with no
 * screen.
 *
 * The reason column *is* the screen. A seller watching their reach fall needs
 * to know which of three things happened, because only one of them is about
 * them: an unsubscribe is a person who has had enough of this shop, a bounce
 * is an address that does not work, and a spam report is a mark against a
 * sending domain every other seller shares. Reporting all three as
 * "unsubscribed" — which is what having no screen amounted to — hides the two
 * that need different action.
 */
export default async function UnsubscribedPage() {
  const { shop } = await requireShop("marketing:read");
  const { a, locale } = await getAdminT();

  const [counts, rows] = await Promise.all([
    suppressionCounts(shop.id),
    suppressionsFor(shop.id),
  ]);

  const clipped = rows.length >= SUPPRESSION_LIMIT;

  const REASONS: Record<string, { label: string; tone: "neutral" | "amber" | "red" }> = {
    unsubscribed: { label: a.broadcasts.subscriberUnsubscribed, tone: "neutral" },
    bounced: { label: a.broadcasts.subscriberBounced, tone: "amber" },
    complained: { label: a.broadcasts.subscriberComplained, tone: "red" },
  };

  return (
    <>
      <Link
        href="/admin/broadcasts"
        className="focus-ring mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 transition pointer-coarse:min-h-11 hover:text-ink-900"
      >
        <ArrowLeft className="size-4" />
        {a.broadcasts.title}
      </Link>

      <PageHeader
        title={a.broadcasts.unsubscribedTitle}
        description={a.broadcasts.unsubscribedDescription}
      />

      {rows.length === 0 ? (
        <EmptyState
          title={a.broadcasts.unsubscribedEmpty}
          description={a.broadcasts.unsubscribedEmptyBody}
        />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <Stat
              label={a.broadcasts.statUnsubscribed}
              value={counts.unsubscribed.toLocaleString(locale)}
            />
            <Stat
              label={a.broadcasts.subscriberBounced}
              value={counts.bounced.toLocaleString(locale)}
            />
            <Stat
              label={a.broadcasts.subscriberComplained}
              value={counts.complained.toLocaleString(locale)}
            />
          </div>

          {/*
            The banner theirs carries, above the table rather than inside a
            confirm dialog: by the time somebody is reading a confirm they have
            already decided.
          */}
          <Alert tone="warning" className="mb-4">
            {a.broadcasts.resubscribeWarning}
          </Alert>

          <Table
            head={
              <Tr>
                <Th>{a.common.email}</Th>
                <Th>{a.broadcasts.unsubscribedReason}</Th>
                <Th>{a.broadcasts.unsubscribedWhen}</Th>
                <Th className="text-end">{a.broadcasts.resubscribe}</Th>
              </Tr>
            }
          >
            <>
              {rows.map((row) => {
                const reason = REASONS[row.reason] ?? {
                  label: row.reason,
                  tone: "neutral" as const,
                };
                return (
                  <Tr key={row.email}>
                    <Td>
                      <span className="font-medium text-ink-900">{row.email}</span>
                      {row.name ? (
                        <span className="block text-xs text-ink-500">{row.name}</span>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge tone={reason.tone}>{reason.label}</Badge>
                    </Td>
                    <Td>
                      <LocalTime at={row.createdAt.toISOString()} />
                    </Td>
                    <Td className="text-end">
                      {/*
                        Rendered only for `unsubscribed`. A bounce or a spam
                        report gets no button at all rather than one that
                        refuses — a disabled control invites a seller to keep
                        pressing it, and rule 8 is not a rate limit.
                      */}
                      {row.reason === "unsubscribed" ? (
                        <Resubscribe email={row.email} />
                      ) : (
                        <span className="text-xs text-ink-400">
                          {a.broadcasts.resubscribeRefused}
                        </span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </>
          </Table>

          {clipped ? (
            <p className="mt-3 text-xs text-ink-500">
              {interpolate(a.broadcasts.subscribersClipped, { count: SUPPRESSION_LIMIT })}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
