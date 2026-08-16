import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import { Mail, Plus } from "lucide-react";
import { getDb } from "@sailo/db";
import { broadcasts, clients } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { getAdminT, getT } from "@/i18n/server";
import { can } from "@/lib/plans";
import { audienceSize } from "@/lib/broadcasts/audience";
import { segmentPickers } from "@/lib/broadcasts/pickers";
import { subscribePageUrl } from "@/lib/broadcasts/subscribe";
import { describeSegment, parseSegment } from "@/lib/broadcasts/segments";
import { PageHeader } from "@sailo/design-system/web";
import { LockedFeature } from "@/app/admin/_components/locked-feature";
import { Badge, Button, Card, EmptyState } from "@sailo/design-system/web";
import { formatMoney } from "@/lib/utils";
import { interpolate } from "@sailo/i18n";
import { GrowCard } from "./_components/grow-card";

export const metadata: Metadata = { title: "Broadcasts" };

const TONES = {
  draft: "neutral",
  scheduled: "blue",
  queuing: "amber",
  sending: "amber",
  sent: "green",
} as const;

/** Contacts who arrived through the signup form and proved the address. */
async function subscriberCount(shopId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(clients)
    .where(
      and(
        eq(clients.shopId, shopId),
        eq(clients.source, "subscribe"),
        // An unconfirmed signup writes no row at all, so this really is
        // "arrived through the form and proved it".
        isNotNull(clients.marketingConsentAt),
      ),
    );
  return row?.n ?? 0;
}

export default async function BroadcastsPage() {
  const { shop } = await requireShop();
  const { a, locale } = await getAdminT();
  const { t } = await getT();

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
        <div className="mt-4">
          <GrowCard
            url={subscribePageUrl(shop.handle)}
            enabled={shop.subscribeEnabled}
            incentive={shop.subscribeIncentive}
            subscriberCount={await subscriberCount(shop.id)}
          />
        </div>
      </>
    );
  }

  const [rows, reach, pickers, subscribers] = await Promise.all([
    getDb().query.broadcasts.findMany({
      where: eq(broadcasts.shopId, shop.id),
      orderBy: [desc(broadcasts.createdAt)],
      limit: 50,
    }),
    audienceSize(shop.id),
    segmentPickers(shop.id),
    subscriberCount(shop.id),
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
        description={interpolate(a.broadcasts.reach, { count: reach })}
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
          number makes a seller ask. */}
      <GrowCard
        url={subscribePageUrl(shop.handle)}
        enabled={shop.subscribeEnabled}
        incentive={shop.subscribeIncentive}
        subscriberCount={subscribers}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Mail className="size-6" />}
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
