import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Plus, Workflow } from "lucide-react";
import { getDb } from "@sailo/db";
import { automationRuns, automations } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { getAdminT, getT } from "@/i18n/server";
import { can } from "@sailo/core/plans";
import { interpolate } from "@sailo/i18n";
import { Badge, Button, Card, EmptyState, PageHeader } from "@sailo/design-system/web";
import { LockedFeature } from "@/app/admin/_components/locked-feature";

export const metadata: Metadata = { title: "Automations" };

const TONES = { draft: "neutral", active: "green", paused: "amber" } as const;

export default async function FlowsPage() {
  const { shop } = await requireShop("marketing:read");
  const { a, locale } = await getAdminT();
  const { t } = await getT();

  if (!can(shop, "automations")) {
    return (
      <LockedFeature
        shop={shop}
        feature="automations"
        icon={<Workflow className="size-6" />}
        title={a.flows.title}
        description={a.flows.lockedBody}
        t={t}
      />
    );
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(automations)
    .where(and(eq(automations.shopId, shop.id), eq(automations.kind, "email")))
    .orderBy(desc(automations.createdAt))
    .limit(50);

  /* One grouped query for every row's count line, not one query per row. */
  const counts = new Map<string, { queued: number; waiting: number; done: number }>();
  if (rows.length > 0) {
    const tallies = await db
      .select({
        automationId: automationRuns.automationId,
        status: automationRuns.status,
        n: sql<string>`count(*)`,
      })
      .from(automationRuns)
      .where(inArray(automationRuns.automationId, rows.map((r) => r.id)))
      .groupBy(automationRuns.automationId, automationRuns.status);
    for (const tally of tallies) {
      const slot = counts.get(tally.automationId) ?? { queued: 0, waiting: 0, done: 0 };
      if (tally.status === "queued") slot.queued += Number(tally.n);
      else if (tally.status === "waiting") slot.waiting += Number(tally.n);
      else if (tally.status === "done") slot.done += Number(tally.n);
      counts.set(tally.automationId, slot);
    }
  }

  const triggerLabels: Record<string, string> = {
    "list.joined": a.flows.triggerListJoined,
    "product.purchased": a.flows.triggerProductPurchased,
    "checkout.abandoned": a.flows.triggerCheckoutAbandoned,
    "waitlist.signup": a.flows.triggerWaitlistSignup,
    "contact.updated": a.flows.triggerContactUpdated,
  };
  const statusLabels: Record<string, string> = {
    draft: a.flows.statusDraft,
    active: a.flows.statusActive,
    paused: a.flows.statusPaused,
  };

  return (
    <>
      <PageHeader
        title={a.flows.title}
        description={a.flows.subtitle}
        action={
          <Link href="/admin/flows/new">
            <Button>
              <Plus className="size-4" />
              {a.flows.create}
            </Button>
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Workflow className="size-6" />}
          title={a.flows.empty}
          description={a.flows.emptyBody}
          action={
            <Link href="/admin/flows/new">
              <Button>
                <Plus className="size-4" />
                {a.flows.create}
              </Button>
            </Link>
          }
        />
      ) : (
        <Card className="divide-y divide-ink-100">
          {rows.map((row) => {
            const tally = counts.get(row.id);
            return (
              <Link
                key={row.id}
                href={`/admin/flows/${row.id}`}
                className="focus-ring flex items-center gap-3 px-5 py-4 transition hover:bg-ink-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink-900">
                    {row.name}
                  </span>
                  <span className="block truncate text-xs text-ink-400">
                    {triggerLabels[row.trigger?.type ?? ""] ?? row.trigger?.type}
                    {" · "}
                    {tally
                      ? interpolate(a.flows.runsSummary, {
                          queued: tally.queued.toLocaleString(locale),
                          waiting: tally.waiting.toLocaleString(locale),
                          done: tally.done.toLocaleString(locale),
                        })
                      : a.flows.runsNone}
                  </span>
                </span>
                <Badge tone={TONES[row.status as keyof typeof TONES] ?? "neutral"}>
                  {statusLabels[row.status] ?? row.status}
                </Badge>
              </Link>
            );
          })}
        </Card>
      )}
    </>
  );
}
