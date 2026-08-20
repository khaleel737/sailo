import { LottieArt } from "@/components/shared/lottie-art";
import envelopeScene from "@/components/shared/lottie/envelope.json";
import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Mail, Plus } from "lucide-react";
import { getDb } from "@sailo/db";
import { broadcasts } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { getAdminT, getT } from "@/i18n/server";
import { can } from "@sailo/core/plans";
import {
  listSubscribers,
  subscribePageUrl,
  subscriberStats,
} from "@sailo/marketing/broadcasts/server";
import { segmentPickers } from "@sailo/workflows/broadcasts";
import { describeSegment, parseSegment } from "@sailo/marketing/broadcasts";
import { PageHeader, EnvelopeArt } from "@sailo/design-system/web";
import { LockedFeature } from "@/app/admin/_components/locked-feature";
import { Badge, Button, Card, EmptyState } from "@sailo/design-system/web";
import { formatMoney } from "@sailo/core/currency";
import { interpolate } from "@sailo/i18n";
import { GrowCard } from "./_components/grow-card";
import { SubscriberList } from "./_components/subscriber-list";

export const metadata: Metadata = { title: "Broadcasts" };

const TONES = {
  draft: "neutral",
  scheduled: "blue",
  queuing: "amber",
  sending: "amber",
  sent: "green",
} as const;

/**
 * How many of the list to show before "see everyone".
 *
 * Enough to prove the thing works and to recognise this morning's signup;
 * short enough that it stays a card on a screen about broadcasts rather than
 * becoming the screen.
 */
const PREVIEW = 5;

export default async function BroadcastsPage() {
  const { shop } = await requireShop("marketing:read");
  const { a, locale } = await getAdminT();
  const { t } = await getT();

  /*
   * Read before the plan check, because both sides of it show this. A seller
   * who cannot yet send still has to be able to see the list they are
   * building, or the free plan looks like a form that swallows addresses.
   */
  const [stats, recent] = await Promise.all([
    subscriberStats(shop.id),
    listSubscribers(shop.id, PREVIEW),
  ]);

  /*
   * How the list is grown, and who it grew into — one block, used twice,
   * so the locked screen and the working one cannot drift apart.
   */
  const audience = (
    <>
      <GrowCard
        url={subscribePageUrl(shop.handle)}
        enabled={shop.subscribeEnabled}
        incentive={shop.subscribeIncentive}
        subscriberCount={stats.viaForm}
      />

      <section className="mb-4">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">
              {a.broadcasts.listTitle}
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">{a.broadcasts.listBody}</p>
          </div>
          {/*
            Three doors onto the same audience, and they are three because the
            questions are: who is on it, how it is grouped, and who has left.
            `Lists` and `Unsubscribed` show whatever the count — a seller with
            no subscribers still needs to be able to make the list they are
            about to collect into, and an empty suppression screen is the
            answer to "why is my reach falling", not a screen to hide.
          */}
          <div className="flex flex-wrap items-center gap-2">
            {stats.consented > 0 ? (
              <Link href="/admin/broadcasts/subscribers">
                <Button variant="secondary" size="sm">
                  {a.broadcasts.seeAllSubscribers}
                </Button>
              </Link>
            ) : null}
            <Link href="/admin/broadcasts/lists">
              <Button variant="secondary" size="sm">
                {a.broadcasts.listsTitle}
              </Button>
            </Link>
            <Link href="/admin/broadcasts/unsubscribed">
              <Button variant="secondary" size="sm">
                {a.broadcasts.unsubscribedTitle}
              </Button>
            </Link>
          </div>
        </div>

        {recent.length === 0 ? (
          /* Not an `EmptyState` — this is a card on a busy screen, and the
             full-height illustration treatment belongs to the page that is
             only about subscribers. */
          <Card className="p-5">
            <p className="text-sm font-medium text-ink-900">
              {a.broadcasts.subscribersEmpty}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              {a.broadcasts.subscribersEmptyBody}
            </p>
          </Card>
        ) : (
          <SubscriberList rows={recent} a={a} locale={locale} />
        )}
      </section>
    </>
  );

  if (!can(shop, "broadcasts")) {
    /*
     * Locked from *sending*, not from collecting.
     *
     * Building a list is the thing a seller on the free plan should be doing
     * today, and gating the signup form would mean the day they upgrade they
     * start from zero — which is also the day they decide the feature is not
     * worth paying for. So the paywall covers the composer and the grow card
     * sits under it, working.
     */
    return (
      <>
        <LockedFeature
          shop={shop}
          feature="broadcasts"
          icon={<Mail className="size-6" />}
          title={a.broadcasts.title}
          description={a.broadcasts.lockedBody}
          t={t}
        />
        <div className="mt-4">{audience}</div>
      </>
    );
  }

  const [rows, pickers] = await Promise.all([
    getDb().query.broadcasts.findMany({
      where: eq(broadcasts.shopId, shop.id),
      orderBy: [desc(broadcasts.createdAt)],
      limit: 50,
    }),
    segmentPickers(shop.id),
  ]);

  /* The names a stored condition needs to read as a sentence. */
  const names = new Map<string, string>();
  for (const option of [...pickers.products, ...pickers.categories, ...pickers.coupons]) {
    names.set(option.id, option.label);
  }

  const ruleLabels = {
    tag: a.broadcasts.ruleTag,
    notTag: a.broadcasts.ruleNotTag,
    source: a.broadcasts.ruleSource,
    country: a.broadcasts.ruleCountry,
    product: a.broadcasts.ruleProduct,
    notProduct: a.broadcasts.ruleNotProduct,
    category: a.broadcasts.ruleCategory,
    kind: a.broadcasts.ruleKind,
    coupon: a.broadcasts.ruleCoupon,
    attended: a.broadcasts.ruleAttended,
    ordered: a.broadcasts.ruleOrdered,
    neverOrdered: a.broadcasts.ruleNeverOrdered,
    minOrders: a.broadcasts.ruleMinOrders,
    minSpend: a.broadcasts.ruleMinSpend,
    orderedWithin: a.broadcasts.ruleOrderedWithin,
    lapsed: a.broadcasts.ruleLapsed,
    abandoned: a.broadcasts.ruleAbandoned,
    joinedWithin: a.broadcasts.ruleJoinedWithin,
    subscribedWithin: a.broadcasts.ruleSubscribedWithin,
  };

  return (
    <>
      <PageHeader
        title={a.broadcasts.title}
        /*
         * The reach is the headline number because it is the one that
         * surprises people. A seller with three hundred customers and eleven
         * opted-in contacts needs to see "11" before they write anything,
         * not after they press Send.
         */
        description={interpolate(a.broadcasts.reach, { count: stats.mailable })}
        action={
          <Link href="/admin/broadcasts/new">
            <Button>
              <Plus className="size-4" />
              {a.broadcasts.compose}
            </Button>
          </Link>
        }
      />

      {/* Directly under that number, because it is the answer to what the
          number makes a seller ask — and then the people it counted. */}
      {audience}

      {rows.length === 0 ? (
        <EmptyState
          art={<LottieArt animation={envelopeScene} fallback={<EnvelopeArt />} />}
          title={a.broadcasts.empty}
          description={a.broadcasts.emptyBody}
        />
      ) : (
        <Card className="divide-y divide-ink-100">
          {rows.map((row) => (
            <Link
              key={row.id}
              href={`/admin/broadcasts/${row.id}`}
              className="focus-ring flex items-center gap-3 px-5 py-4 transition hover:bg-ink-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink-900">
                  {row.subject}
                </span>
                <span className="block truncate text-xs text-ink-400">
                  {(row.scheduledAt ?? row.sentAt ?? row.createdAt).toLocaleDateString(
                    locale,
                    { day: "numeric", month: "short", year: "numeric" },
                  )}
                  {" · "}
                  {/* Who it went to, in the same words the builder used —
                      a row that only said "vip" could not describe an
                      audience with four conditions on it. */}
                  {describeSegment(parseSegment(row.audienceFilter, row.audienceTag), {
                    labels: ruleLabels,
                    names,
                    missing: a.broadcasts.deletedItem,
                    money: (minor) => formatMoney(minor, shop.currency, locale),
                    everyone: a.broadcasts.everyone,
                    join: { all: " · ", any: " / " },
                  })}
                  {row.recipientCount > 0
                    ? ` · ${row.recipientCount.toLocaleString(locale)}`
                    : ""}
                </span>
              </span>
              <Badge tone={TONES[row.status as keyof typeof TONES] ?? "neutral"}>
                {a.broadcastStatus[row.status as keyof typeof a.broadcastStatus] ??
                  row.status}
              </Badge>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
