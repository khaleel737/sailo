import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { ShoppingCart, Workflow } from "lucide-react";
import { getDb } from "@sailo/db";
import { checkoutSessions, orders, products } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { formatMoney } from "@sailo/core/currency";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Stat,
} from "@sailo/design-system/web";
import { RecoveryToggle } from "./_components/recovery-toggle";

export const metadata: Metadata = { title: "Abandoned checkouts" };

/** The list stays a page, not an archive. History beyond this is the stats'. */
const LIMIT = 50;

/**
 * Checkouts that started and stopped — spec 32's seller-facing half.
 *
 * The engine has run since the spec landed: sessions tracked, the one-time
 * recovery email, the resume links, the expiry sweep. What was missing was a
 * place to *see* any of it, which meant the recovery switch shipped as a
 * column nobody could reach. This page is the ledger and the switch.
 */
export default async function AbandonedPage() {
  const { shop } = await requireShop("orders:read");
  const { a, locale } = await getAdminT();
  const db = getDb();

  const [rows, tallies] = await Promise.all([
    db
      .select({
        session: checkoutSessions,
        productTitle: products.title,
      })
      .from(checkoutSessions)
      .leftJoin(products, eq(products.id, checkoutSessions.productId))
      .where(eq(checkoutSessions.shopId, shop.id))
      .orderBy(desc(checkoutSessions.openedAt))
      .limit(LIMIT),
    db
      .select({
        open: sql<string>`count(*) filter (where ${checkoutSessions.status} in ('opened','error') and ${checkoutSessions.orderId} is null)`,
        emailed: sql<string>`count(*) filter (where ${checkoutSessions.recoverySentAt} is not null)`,
        recovered: sql<string>`count(*) filter (where ${checkoutSessions.recoveredAt} is not null)`,
        /*
         * Recovered funds read the *order*, never the session's subtotal —
         * the same rule `recoveryStats` documents. The session records what
         * the basket was worth when it was abandoned, in whatever currency
         * the buyer was browsing; the order records what was actually paid.
         * Summing session subtotals overstated every recovery by the
         * discount that caused it, and added a ¥5,000 basket into a figure
         * labelled "€".
         */
        recoveredCents: sql<string>`coalesce(sum(${orders.totalCents}) filter (where ${checkoutSessions.recoveredAt} is not null), 0)`,
      })
      .from(checkoutSessions)
      .leftJoin(orders, eq(orders.id, checkoutSessions.orderId))
      .where(eq(checkoutSessions.shopId, shop.id)),
  ]);

  const stats = tallies[0] ?? {
    open: "0",
    emailed: "0",
    recovered: "0",
    recoveredCents: "0",
  };

  const statusOf = (s: (typeof rows)[number]["session"]) => {
    if (s.recoveredAt) return { label: a.abandoned.statusRecovered, tone: "green" as const };
    if (s.orderId) return { label: a.abandoned.statusCompleted, tone: "green" as const };
    if (s.status === "expired") return { label: a.abandoned.statusExpired, tone: "neutral" as const };
    if (s.recoverySentAt) return { label: a.abandoned.statusEmailed, tone: "blue" as const };
    return { label: a.abandoned.statusOpen, tone: "amber" as const };
  };

  return (
    <>
      <PageHeader title={a.abandoned.title} description={a.abandoned.subtitle} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={a.abandoned.statOpen} value={Number(stats.open).toLocaleString(locale)} />
        <Stat
          label={a.abandoned.statEmailed}
          value={Number(stats.emailed).toLocaleString(locale)}
        />
        <Stat
          label={a.abandoned.statRecovered}
          value={Number(stats.recovered).toLocaleString(locale)}
        />
        <Stat
          label={a.abandoned.statRevenue}
          value={formatMoney(Number(stats.recoveredCents), shop.currency, locale)}
        />
      </div>

      <Card className="mb-4 space-y-3 p-5">
        <RecoveryToggle enabled={shop.recoveryEnabled} />
        <p className="flex items-center gap-2 text-xs text-ink-500">
          <Workflow className="size-3.5 shrink-0" />
          {a.abandoned.flowsHint}{" "}
          <Link href="/admin/flows" className="font-medium text-ink-900 underline">
            {a.abandoned.flowsLink}
          </Link>
        </p>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="size-6" />}
          title={a.abandoned.empty}
          description={a.abandoned.emptyBody}
          action={
            <Link href="/admin/flows/new">
              <Button variant="secondary">{a.flows.create}</Button>
            </Link>
          }
        />
      ) : (
        <Card className="divide-y divide-ink-100">
          {rows.map(({ session, productTitle }) => {
            const status = statusOf(session);
            return (
              <div key={session.id} className="flex items-center gap-3 px-5 py-4">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink-900">
                    {session.email ?? a.abandoned.noEmail}
                  </span>
                  <span className="block truncate text-xs text-ink-400">
                    {session.openedAt.toLocaleDateString(locale, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {" · "}
                    {productTitle ?? a.abandoned.cartOnly}
                  </span>
                </span>
                {session.subtotalCents !== null && session.currency ? (
                  <span className="tabular shrink-0 text-sm text-ink-700">
                    {formatMoney(session.subtotalCents, session.currency, locale)}
                  </span>
                ) : null}
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
            );
          })}
        </Card>
      )}

      {rows.length === LIMIT ? (
        /* The page shows a window and says so — no silent caps. */
        <p className="mt-2 text-xs text-ink-400">
          {interpolate(a.abandoned.showing, { count: String(LIMIT) })}
        </p>
      ) : null}
    </>
  );
}
