"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { automationEmails, automations } from "@sailo/db/schema";
import type { AutomationGraph, AutomationTrigger } from "@sailo/db/schema/json-types";
import { requireShop } from "@/lib/session";
import { firstRow } from "@sailo/core/invariant";
import { can, upgradeMessage } from "@sailo/core/plans";
import { isUuid } from "@sailo/core/uuid";
import {
  MAX_TIMER_DAYS,
  isTriggerType,
  parseGraph,
} from "@sailo/marketing/automations";
import type { Shop } from "@sailo/db/schema";

/** Building, activating and pausing a flow — spec 30's seller half. */

export type FlowState = { ok: boolean; error?: string; problems?: string[] };

/**
 * What the editor sends: the linear form of the graph.
 *
 * The stored shape stays a graph — this is the builder's dialect of it, and
 * `saveFlow` compiles it through the same `parseGraph` the runner trusts, so
 * nothing the editor can express is invalid by construction rather than by
 * check.
 */
export type FlowStep =
  | {
      kind: "send";
      nodeId?: string;
      emailId?: string;
      name: string;
      subject: string;
      preheader: string;
      body: string;
    }
  | { kind: "timer"; nodeId?: string; minutes: number }
  | { kind: "filter"; nodeId?: string; tag: string };

export type FlowDraft = {
  name: string;
  entryPolicy: "once" | "repeat";
  trigger: {
    type: string;
    listId?: string;
    productIds?: string[];
    productId?: string;
    /** For `contact.updated`: which fields wake the flow. Empty means any. */
    fields?: string[];
  };
  steps: FlowStep[];
};

/** The one field the builder offers to watch. The engine takes any list. */
const WATCHABLE_FIELDS = ["tags"] as const;

/**
 * The gate, in one place — the `editable()` shape next door in
 * `broadcasts.ts`, and for the same reason: every entry point below is a way
 * to put mail in somebody's inbox on a schedule, so every one re-asks.
 */
async function gate(): Promise<
  { ok: true; shop: Shop } | { ok: false; error: string }
> {
  const { shop } = await requireShop("marketing:send");
  if (!can(shop, "automations")) {
    return { ok: false, error: upgradeMessage("automations", "Automations") };
  }
  return { ok: true, shop };
}

async function ownFlow(shopId: string, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await getDb()
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.id, id),
        eq(automations.shopId, shopId),
        eq(automations.kind, "email"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The trigger, from the create form's fields to the enrol path's config. */
function triggerFrom(input: FlowDraft["trigger"]): AutomationTrigger | null {
  if (!isTriggerType(input.type)) return null;
  const config: Record<string, unknown> = {};
  if (input.type === "list.joined" && isUuid(input.listId ?? "")) {
    config.listId = input.listId;
  }
  if (input.type === "product.purchased") {
    /* The form's single picker and the editor's array are one config. */
    const ids = [...(input.productIds ?? []), input.productId ?? ""].filter((id) =>
      isUuid(id),
    );
    if (ids.length > 0) config.productIds = [...new Set(ids)];
  }
  if (input.type === "waitlist.signup" && isUuid(input.productId ?? "")) {
    config.productId = input.productId;
  }
  if (input.type === "checkout.abandoned") {
    /* The purchased trigger's vocabulary: absent means any product. */
    const ids = [...(input.productIds ?? []), input.productId ?? ""].filter((id) =>
      isUuid(id),
    );
    if (ids.length > 0) config.productIds = [...new Set(ids)];
  }
  if (input.type === "contact.updated") {
    const fields = (input.fields ?? []).filter((f) =>
      (WATCHABLE_FIELDS as readonly string[]).includes(f),
    );
    if (fields.length > 0) config.fields = fields;
  }
  return { type: input.type, config };
}

/* --------------------------------------------------------------------------
   Create
-------------------------------------------------------------------------- */

export async function createFlow(
  _prev: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const gated = await gate();
  if (!gated.ok) return { ok: false, error: gated.error };

  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "empty" };

  const trigger = triggerFrom({
    type: String(formData.get("trigger") ?? ""),
    listId: String(formData.get("listId") ?? "") || undefined,
    productId: String(formData.get("productId") ?? "") || undefined,
    productIds: formData.getAll("productIds").map(String),
    fields:
      String(formData.get("updatedFields") ?? "") === "tags" ? ["tags"] : undefined,
  });
  if (!trigger) return { ok: false, error: "trigger" };

  const row = firstRow(
    await getDb()
      .insert(automations)
      .values({ shopId: gated.shop.id, name, kind: "email", status: "draft", trigger })
      .returning({ id: automations.id }),
    "automation",
  );

  revalidatePath("/admin/flows");
  redirect(`/admin/flows/${row.id}`);
}

/* --------------------------------------------------------------------------
   Save — the editor's whole state in one write
-------------------------------------------------------------------------- */

export async function saveFlow(id: string, draft: FlowDraft): Promise<FlowState> {
  const gated = await gate();
  if (!gated.ok) return { ok: false, error: gated.error };

  const row = await ownFlow(gated.shop.id, id);
  if (!row) return { ok: false, error: "missing" };
  /*
   * Their rule, adopted by the spec: pause before editing. It is what makes
   * the cursor-into-a-deleted-node case rare rather than routine, and the
   * editor shows the same refusal before a seller types anything.
   */
  if (row.status === "active") return { ok: false, error: "active" };

  const name = draft.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "empty" };
  const trigger = triggerFrom(draft.trigger);
  if (!trigger) return { ok: false, error: "trigger" };
  const entryPolicy = draft.entryPolicy === "repeat" ? "repeat" : "once";

  /*
   * Every refusal happens before any write. The old order upserted the email
   * rows and swept the orphans first, then asked parseGraph — so a save the
   * validator refused had already destroyed the seller's written copy: clear
   * the steps of a paused flow, press Save, be told it did not happen, and
   * every subject and body is gone to the orphan sweep while the stored
   * graph's send nodes still point at the deleted rows.
   */
  const emailFields = new Map<
    number,
    {
      name: string;
      subject: string;
      preheader: string | null;
      bodyMarkdown: string;
      position: number;
      updatedAt: Date;
    }
  >();
  for (const [index, step] of draft.steps.entries()) {
    if (step.kind === "timer") {
      const minutes = Math.trunc(Number(step.minutes));
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_TIMER_DAYS * 1_440) {
        return { ok: false, error: "timer" };
      }
    }
    if (step.kind !== "send") continue;
    const fields = {
      name: step.name.trim().slice(0, 120) || step.subject.trim().slice(0, 120),
      subject: step.subject.trim().slice(0, 300),
      preheader: step.preheader.trim().slice(0, 300) || null,
      bodyMarkdown: step.body.slice(0, 100_000),
      position: index,
      updatedAt: new Date(),
    };
    if (!fields.subject || !fields.bodyMarkdown.trim()) {
      return { ok: false, error: "email", problems: [String(index + 1)] };
    }
    emailFields.set(index, fields);
  }

  /* The linear dialect, compiled: n steps, n nodes, n−1 unlabelled edges. */
  const nodesFrom = (emailIdOf: (index: number) => string | undefined) =>
    draft.steps.map((step, index) => {
      const nodeId =
        step.nodeId && /^[\w-]{1,64}$/.test(step.nodeId)
          ? step.nodeId
          : `s-${crypto.randomUUID().slice(0, 8)}`;
      if (step.kind === "send") {
        return { id: nodeId, kind: "send", config: { emailId: emailIdOf(index) } };
      }
      if (step.kind === "timer") {
        const minutes = Math.trunc(Number(step.minutes));
        return { id: nodeId, kind: "timer", config: { mode: "duration", minutes } };
      }
      const tag = step.tag.trim().slice(0, 60);
      return {
        id: nodeId,
        kind: "filter",
        config: { segment: { match: "all", rules: [{ type: "tag", value: tag }] } },
      };
    });
  const graphOf = (nodes: ReturnType<typeof nodesFrom>): AutomationGraph => ({
    nodes,
    edges: nodes.flatMap((node, i) => {
      const next = nodes[i + 1];
      return next ? [{ from: node.id, to: next.id }] : [];
    }),
    entry: nodes[0]?.id,
  });

  /*
   * The same reader the runner trusts — refused here means refused everywhere.
   * Probed with a placeholder email id, because the real ids do not exist
   * until the rows are written and nothing may be written until this answers.
   * The saved graph below differs from the probe only in those id strings,
   * and the parser asks no more of them than being non-empty — so a probe
   * that passes cannot become a save that fails.
   */
  const probe = parseGraph(graphOf(nodesFrom(() => "probe")));
  if (!probe.ok) {
    return {
      ok: false,
      error: "graph",
      problems: probe.problems.map((p) => p.code),
    };
  }

  const db = getDb();
  const existing = await db
    .select({ id: automationEmails.id })
    .from(automationEmails)
    .where(eq(automationEmails.automationId, row.id));
  const known = new Set(existing.map((e) => e.id));

  /* Emails first, because the graph's send nodes need their ids. */
  const kept = new Set<string>();
  const emailIdFor = new Map<number, string>();
  for (const [index, step] of draft.steps.entries()) {
    if (step.kind !== "send") continue;
    const fields = emailFields.get(index);
    if (!fields) continue; // Unreachable: every send step was validated above.
    if (step.emailId && known.has(step.emailId)) {
      await db
        .update(automationEmails)
        .set(fields)
        .where(eq(automationEmails.id, step.emailId));
      kept.add(step.emailId);
      emailIdFor.set(index, step.emailId);
    } else {
      const made = firstRow(
        await db
          .insert(automationEmails)
          .values({ automationId: row.id, ...fields })
          .returning({ id: automationEmails.id }),
        "automation email",
      );
      kept.add(made.id);
      emailIdFor.set(index, made.id);
    }
  }
  const orphans = existing.map((e) => e.id).filter((eid) => !kept.has(eid));
  if (orphans.length > 0) {
    await db.delete(automationEmails).where(inArray(automationEmails.id, orphans));
  }

  const graph = graphOf(nodesFrom((index) => emailIdFor.get(index)));

  await db
    .update(automations)
    .set({ name, trigger, graph, entryPolicy, updatedAt: new Date() })
    .where(eq(automations.id, row.id));

  revalidatePath("/admin/flows");
  revalidatePath(`/admin/flows/${row.id}`);
  return { ok: true };
}

/* --------------------------------------------------------------------------
   Activate · pause · delete
-------------------------------------------------------------------------- */

export async function activateFlow(id: string): Promise<FlowState> {
  const gated = await gate();
  if (!gated.ok) return { ok: false, error: gated.error };
  const row = await ownFlow(gated.shop.id, id);
  if (!row) return { ok: false, error: "missing" };

  const parsed = parseGraph(row.graph);
  if (!parsed.ok) {
    return { ok: false, error: "graph", problems: parsed.problems.map((p) => p.code) };
  }
  /* A flow that never sends does nothing — refused at the moment it would
     start doing nothing, not at save, where a half-built draft is normal. */
  const sends = [...parsed.graph.nodes.values()].some((n) => n.kind === "send");
  if (!sends) return { ok: false, error: "needsSend" };

  await getDb()
    .update(automations)
    .set({ status: "active", activatedAt: new Date(), updatedAt: new Date() })
    .where(eq(automations.id, row.id));
  revalidatePath("/admin/flows");
  revalidatePath(`/admin/flows/${row.id}`);
  return { ok: true };
}

export async function pauseFlow(id: string): Promise<FlowState> {
  const gated = await gate();
  if (!gated.ok) return { ok: false, error: gated.error };
  const row = await ownFlow(gated.shop.id, id);
  if (!row) return { ok: false, error: "missing" };

  /* Waiting runs keep their `wake_at` untouched and resume on activation. */
  await getDb()
    .update(automations)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(automations.id, row.id));
  revalidatePath("/admin/flows");
  revalidatePath(`/admin/flows/${row.id}`);
  return { ok: true };
}

export async function deleteFlow(id: string): Promise<FlowState> {
  const gated = await gate();
  if (!gated.ok) return { ok: false, error: gated.error };
  const row = await ownFlow(gated.shop.id, id);
  if (!row) return { ok: false, error: "missing" };
  if (row.status === "active") return { ok: false, error: "active" };

  /*
   * Runs and steps cascade; the `broadcast_deliveries` rows do not — they are
   * reputation evidence, referenced `set null`, and outlive the flow.
   */
  await getDb().delete(automations).where(eq(automations.id, row.id));
  revalidatePath("/admin/flows");
  redirect("/admin/flows");
}
