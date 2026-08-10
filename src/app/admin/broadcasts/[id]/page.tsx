import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { getDb } from "@/db";
import { broadcasts } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { can } from "@/lib/plans";
import { getShopClients } from "@/lib/queries";
import { tagVocabulary } from "@/lib/client-tags";
import { audienceSize } from "@/lib/broadcasts/audience";
import { broadcastProgress } from "@/lib/broadcasts/send";
import { deleteBroadcast } from "@/lib/actions/broadcasts";
import { PageHeader } from "@/components/shared/page-header";
import { Button, Card } from "@/components/ui";
import { Composer } from "../_components/composer";
import { isUuid } from "@/lib/utils";

export const metadata: Metadata = { title: "Broadcast" };

export default async function BroadcastPage({
  params,
}: PageProps<"/admin/broadcasts/[id]">) {
  const { id } = await params;
  const { shop } = await requireShop();
  const { a, locale } = await getAdminT();
  if (!can(shop, "broadcasts") || !isUuid(id)) notFound();

  const broadcast = await getDb().query.broadcasts.findFirst({
    // Shop-scoped in the WHERE, so a guessed id from another shop is a 404
    // rather than somebody else's marketing copy.
    where: and(eq(broadcasts.id, id), eq(broadcasts.shopId, shop.id)),
  });
  if (!broadcast) notFound();

  const [clients, audienceCount, progress] = await Promise.all([
    getShopClients(shop.id),
    audienceSize(shop.id, broadcast.audienceTag),
    broadcastProgress(broadcast.id),
  ]);

  const started = broadcast.status !== "draft";

  return (
    <>
      <Link
        href="/admin/broadcasts"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 transition hover:text-ink-900"
      >
        <ArrowLeft className="size-4" />
        {a.broadcasts.title}
      </Link>

      <PageHeader
        title={broadcast.subject || a.broadcasts.compose}
        description={
          broadcast.sentAt
            ? `${a.broadcastStatus.sent} · ${broadcast.sentAt.toLocaleString(locale)}`
            : a.broadcasts.composeBody
        }
        action={
          broadcast.status === "draft" ? (
            <form action={deleteBroadcast}>
              <input type="hidden" name="id" value={broadcast.id} />
              <Button variant="ghost" size="sm" type="submit">
                <Trash2 className="size-4" />
                {a.common.delete}
              </Button>
            </form>
          ) : null
        }
      />

      {started ? (
        /*
         * Every number, including the unhappy ones.
         *
         * `sending` is the count of rows claimed by a tick that never came
         * back — we do not know whether those went out, and they are not
         * retried, because a duplicate marketing email costs more than a
         * missing one. Showing the number is how that stays honest rather
         * than becoming a quiet discrepancy between "900 recipients" and 897
         * sends.
         */
        <Card className="mb-4 grid grid-cols-2 gap-4 p-5 sm:grid-cols-5">
          {(
            [
              ["sent", progress.sent],
              ["queued", progress.queued],
              ["sending", progress.sending],
              ["failed", progress.failed],
              ["suppressed", progress.suppressed],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <p className="text-xs text-ink-500">{a.deliveryStatus[key]}</p>
              <p className="tabular mt-0.5 text-lg font-semibold text-ink-900">
                {value.toLocaleString(locale)}
              </p>
            </div>
          ))}
        </Card>
      ) : null}

      <Composer
        broadcast={broadcast}
        tags={tagVocabulary(clients)}
        audienceCount={audienceCount}
      />
    </>
  );
}
