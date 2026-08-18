import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import {
  SUBSCRIBER_LIMIT,
  listSubscribers,
  subscriberStats,
} from "@sailo/marketing/broadcasts/server";
import { Card, EmptyState, PageHeader } from "@sailo/design-system/web";
import { interpolate } from "@sailo/i18n";
import { SubscriberList } from "../_components/subscriber-list";

export const metadata: Metadata = { title: "Subscribers" };

/*
 * Per-seller, behind a session, and re-read on every visit — the same as the
 * admin layout above it, and stated here because the layout's declaration does
 * not carry to a route reached by a client-side navigation: clicking through
 * from the broadcasts screen logged "uncached data during a navigation" until
 * this said so.
 */
export const instant = false;

/**
 * Who is on the list.
 *
 * Not behind the `broadcasts` plan gate, and deliberately so — the same
 * reasoning as the grow card it is reached from. Collecting is what a seller
 * on the free plan should be doing today; being unable to see the people they
 * collected is how they conclude nothing is being collected at all.
 *
 * The list is not the clients screen with a filter on it. That screen is
 * ordered by last order and titled "everyone who has ordered from you", which
 * puts somebody who signed up this morning and has never bought anything at
 * the very bottom, under a heading that says they are not there. This one is
 * ordered by the day they opted in and says what that opt-in is worth today.
 */
export default async function SubscribersPage() {
  const { shop } = await requireShop();
  const { a, locale } = await getAdminT();

  const [stats, rows] = await Promise.all([
    subscriberStats(shop.id),
    listSubscribers(shop.id),
  ]);

  const clipped = rows.length >= SUBSCRIBER_LIMIT;

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
        title={a.broadcasts.subscribersTitle}
        description={a.broadcasts.subscribersDescription}
      />

      {stats.consented > 0 ? (
        /*
         * Five numbers rather than one, because the gap between them is the
         * thing a seller actually needs explaining: "opted in" is what they
         * built, "can be reached" is what the next send will go to, and the
         * three underneath are where the difference went.
         */
        <Card className="mb-4 grid grid-cols-2 gap-4 p-5 sm:grid-cols-5">
          {(
            [
              /* Written out rather than looked up by key: `admin-coverage`
                 scans the source for whole dictionary reads, and counts a key
                 it cannot see as a translation nobody shows. */
              [a.broadcasts.statOnList, stats.consented],
              [a.broadcasts.statReachable, stats.mailable],
              [a.broadcasts.statFromForm, stats.viaForm],
              [a.broadcasts.statUnsubscribed, stats.unsubscribed],
              [a.broadcasts.statRefused, stats.refused],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-ink-500">{label}</p>
              <p className="tabular mt-0.5 text-lg font-semibold text-ink-900">
                {value.toLocaleString(locale)}
              </p>
            </div>
          ))}
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title={a.broadcasts.subscribersEmpty}
          description={a.broadcasts.subscribersEmptyBody}
        />
      ) : (
        <>
          <SubscriberList rows={rows} a={a} locale={locale} />
          {/* A ceiling a shop can reach silently is worse than none: the page
              would render what it got as the whole list. */}
          {clipped ? (
            <p className="mt-3 text-xs text-ink-500">
              {interpolate(a.broadcasts.subscribersClipped, {
                count: SUBSCRIBER_LIMIT.toLocaleString(locale),
              })}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
