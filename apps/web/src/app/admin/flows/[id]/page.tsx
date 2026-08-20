import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Workflow } from "lucide-react";
import { getDb } from "@sailo/db";
import { automationEmails, automationRuns, automations } from "@sailo/db/schema";
import type { AutomationEdge } from "@sailo/db/schema/json-types";
import { requireShop } from "@/lib/session";
import { getAdminT, getT } from "@/i18n/server";
import { can } from "@sailo/core/plans";
import { isUuid } from "@sailo/core/uuid";
import { parseGraph } from "@sailo/marketing/automations";
import { runCountsByNode } from "@sailo/marketing/automations/server";
import { listsFor } from "@sailo/marketing/contacts/server";
import { segmentPickers } from "@sailo/workflows/broadcasts";
import { PageHeader } from "@sailo/design-system/web";
import { LockedFeature } from "@/app/admin/_components/locked-feature";
import { FlowEditor, type EditorStep } from "../_components/flow-editor";

export const metadata: Metadata = { title: "Automations" };

/**
 * One flow: its trigger, its steps, and where everybody currently is.
 *
 * The stored shape is a graph; this editor draws the linear dialect of it —
 * one path, no branches — which is every flow this builder writes and the
 * overwhelming shape of real ones. A graph that is not linear (branches,
 * integration actions, several paths) is shown honestly as one this screen
 * cannot draw yet, with activate, pause and delete still working.
 */
export default async function FlowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  if (!isUuid(id)) notFound();
  const db = getDb();
  const [flow] = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.id, id),
        eq(automations.shopId, shop.id),
        eq(automations.kind, "email"),
      ),
    )
    .limit(1);
  if (!flow) notFound();

  const [emails, tallies, hereNow, lists, pickers] = await Promise.all([
    db
      .select()
      .from(automationEmails)
      .where(eq(automationEmails.automationId, flow.id))
      .orderBy(automationEmails.position),
    db
      .select({ status: automationRuns.status, n: sql<string>`count(*)` })
      .from(automationRuns)
      .where(eq(automationRuns.automationId, flow.id))
      .groupBy(automationRuns.status),
    runCountsByNode(flow.id),
    listsFor(shop.id),
    segmentPickers(shop.id),
  ]);

  const stats = { queued: 0, waiting: 0, done: 0, failed: 0, cancelled: 0 };
  for (const tally of tallies) {
    if (tally.status in stats) {
      stats[tally.status as keyof typeof stats] = Number(tally.n);
    }
  }

  /* The graph, read back as a straight line — or refused as "advanced". */
  const emailById = new Map(emails.map((e) => [e.id, e]));
  let steps: EditorStep[] | null = [];
  const parsed = flow.graph ? parseGraph(flow.graph) : null;
  if (parsed?.ok) {
    let cursor: string | undefined = parsed.graph.entry;
    const seen = new Set<string>();
    while (cursor && steps) {
      if (seen.has(cursor)) {
        steps = null; // A cycle: legal for the runner, not drawable here.
        break;
      }
      seen.add(cursor);
      const node = parsed.graph.nodes.get(cursor);
      const leaving: AutomationEdge[] = parsed.graph.out.get(cursor) ?? [];
      if (!node || leaving.length > 1) {
        steps = null;
        break;
      }
      if (node.kind === "send") {
        const email = emailById.get(node.emailId);
        steps.push({
          kind: "send",
          nodeId: node.id,
          emailId: node.emailId,
          name: email?.name ?? "",
          subject: email?.subject ?? "",
          preheader: email?.preheader ?? "",
          body: email?.bodyMarkdown ?? "",
        });
      } else if (node.kind === "timer" && node.mode === "duration") {
        steps.push({ kind: "timer", nodeId: node.id, minutes: node.minutes });
      } else if (node.kind === "filter") {
        const rule = node.segment.rules[0];
        const linear =
          node.segment.rules.length <= 1 && (!rule || rule.type === "tag");
        if (!linear) {
          steps = null;
          break;
        }
        steps.push({
          kind: "filter",
          nodeId: node.id,
          tag: rule && "value" in rule ? String(rule.value) : "",
        });
      } else {
        steps = null; // branch, whatsapp, action, or a non-duration timer.
        break;
      }
      cursor = leaving[0]?.to;
    }
  } else if (flow.graph) {
    steps = null; // Stored but unreadable: never silently redraw it as empty.
  }

  const trigger = flow.trigger ?? { type: "list.joined" };
  const config = (trigger.config ?? {}) as Record<string, unknown>;

  return (
    <>
      <PageHeader
        back={{ href: "/admin/flows", label: a.flows.title }}
        title={flow.name}
        description={
          flow.activatedAt
            ? a.flows.activeSince.replace(
                "{date}",
                flow.activatedAt.toLocaleDateString(locale, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }),
              )
            : a.flows.neverActivated
        }
      />
      <FlowEditor
        flowId={flow.id}
        status={flow.status as "draft" | "active" | "paused"}
        name={flow.name}
        entryPolicy={flow.entryPolicy === "repeat" ? "repeat" : "once"}
        trigger={{
          type: trigger.type,
          listId: typeof config.listId === "string" ? config.listId : undefined,
          productId: Array.isArray(config.productIds)
            ? String(config.productIds[0] ?? "")
            : typeof config.productId === "string"
              ? config.productId
              : undefined,
          fields: Array.isArray(config.fields)
            ? config.fields.map(String)
            : undefined,
        }}
        steps={steps}
        stats={stats}
        hereNow={Object.fromEntries(hereNow)}
        lists={lists.map((l) => ({ id: l.id, label: l.name }))}
        products={pickers.products}
      />
    </>
  );
}
