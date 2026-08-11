import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ArrowLeft, Copy, Trash2 } from "lucide-react";
import { getDb } from "@sailo/db";
import { broadcasts } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { can } from "@/lib/plans";
import { segmentPickers } from "@/lib/broadcasts/pickers";
import { broadcastProgress, MAX_PROMO_PRODUCTS } from "@/lib/broadcasts/send";
import { deleteBroadcast, duplicateBroadcast } from "@/lib/actions/broadcasts";
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

  const [pickers, progress] = await Promise.all([
    segmentPickers(shop.id),
    broadcastProgress(broadcast.id),
  ]);

  const started = broadcast.status !== "draft" && broadcast.status !== "scheduled";

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
          <div className="flex items-center gap-1">
            {/*
              Duplicating a sent campaign is how the next one gets written.
              Without it the audience is retyped from memory, which is where
              a segment quietly stops matching what the seller meant.
            */}
            <form action={duplicateBroadcast}>
              <input type="hidden" name="id" value={broadcast.id} />
              <Button variant="ghost" size="sm" type="submit">
                <Copy className="size-4" />
                {a.broadcasts.duplicate}
              </Button>
            </form>
            {started ? null : (
              <form action={deleteBroadcast}>
                <input type="hidden" name="id" value={broadcast.id} />
                <Button variant="ghost" size="sm" type="submit">
                  <Trash2 className="size-4" />
                  {a.common.delete}
                </Button>
              </form>
            )}
          </div>
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
        pickers={pickers}
        currency={shop.currency}
        timeZone={shop.timeZone}
        maxProducts={MAX_PROMO_PRODUCTS}
      />
    </>
  );
}
