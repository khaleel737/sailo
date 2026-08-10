import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Mail, Plus } from "lucide-react";
import { getDb } from "@/db";
import { broadcasts } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { getAdminT, getT } from "@/i18n/server";
import { can } from "@/lib/plans";
import { audienceSize } from "@/lib/broadcasts/audience";
import { PageHeader } from "@/components/shared/page-header";
import { LockedFeature } from "@/app/admin/_components/locked-feature";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { interpolate } from "@/i18n";

export const metadata: Metadata = { title: "Broadcasts" };

const TONES = {
  draft: "neutral",
  sending: "amber",
  sent: "green",
} as const;

export default async function BroadcastsPage() {
  const { shop } = await requireShop();
  const { a, locale } = await getAdminT();
  const { t } = await getT();

  if (!can(shop, "broadcasts")) {
    return (
      <LockedFeature
        shop={shop}
        feature="broadcasts"
        icon={<Mail className="size-6" />}
        title={a.broadcasts.title}
        description={a.broadcasts.lockedBody}
        t={t}
      />
    );
  }

  const [rows, reach] = await Promise.all([
    getDb().query.broadcasts.findMany({
      where: eq(broadcasts.shopId, shop.id),
      orderBy: [desc(broadcasts.createdAt)],
      limit: 50,
    }),
    audienceSize(shop.id, null),
  ]);

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
                <span className="block text-xs text-ink-400">
                  {(row.sentAt ?? row.createdAt).toLocaleDateString(locale, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {row.audienceTag ? ` · ${row.audienceTag}` : ""}
                  {row.recipientCount > 0
                    ? ` · ${row.recipientCount.toLocaleString(locale)}`
                    : ""}
                </span>
              </span>
              <Badge tone={TONES[row.status as keyof typeof TONES] ?? "neutral"}>
                {a.broadcastStatus[row.status as "draft" | "sending" | "sent"] ??
                  row.status}
              </Badge>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
