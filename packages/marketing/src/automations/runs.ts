import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  automationEmails,
  automationRuns,
  automationSteps,
  automations,
  broadcastDeliveries,
} from "@sailo/db/schema";

/**
 * What a flow has done — the Runs and Analytics tabs.
 *
 * **No new counters.** Every number here is computed from rows that already
 * exist: `automation_runs` for where people are, `automation_steps` for how
 * they got there, and `broadcast_deliveries` for what happened to the mail.
 * A denormalised count would be a second thing to keep in step with the ledger
 * and the first thing to drift — and the ledger is the one a deliverability
 * question is answered from, so the copy must never be the authority.
 */

export type AutomationCounts = {
  /** Everybody who has ever entered. */
  total: number;
  /** Standing on a node, waiting for a timer or for the next tick. */
  live: number;
  completed: number;
  failed: number;
  /** Left by unsubscribing from this flow, or by a downgrade. */
  cancelled: number;
};

/** The four numbers on an automation's header, in one statement. */
export async function countsFor(automationId: string): Promise<AutomationCounts> {
  const [row] = await getDb()
    .select({
      total: sql<string>`count(*)`,
      live: sql<string>`count(*) filter (where ${automationRuns.status} in ('queued','waiting'))`,
      completed: sql<string>`count(*) filter (where ${automationRuns.status} = 'done')`,
      failed: sql<string>`count(*) filter (where ${automationRuns.status} = 'failed')`,
      cancelled: sql<string>`count(*) filter (where ${automationRuns.status} = 'cancelled')`,
    })
    .from(automationRuns)
    .where(eq(automationRuns.automationId, automationId));

  return {
    total: Number(row?.total ?? 0),
    live: Number(row?.live ?? 0),
    completed: Number(row?.completed ?? 0),
    failed: Number(row?.failed ?? 0),
    cancelled: Number(row?.cancelled ?? 0),
  };
}

export type EmailStats = {
  id: string;
  name: string;
  subject: string;
  sent: number;
  failed: number;
  suppressed: number;
};

/**
 * Per-email delivery counts, joined through the steps that produced them.
 *
 * Through `automation_steps.delivery_id` rather than by giving deliveries an
 * automation column: the delivery ledger is shared with broadcasts, and adding
 * a nullable foreign key to it for one feature's convenience is how a table
 * that answers deliverability questions grows a column that only one reader
 * understands.
 */
export async function emailStatsFor(automationId: string): Promise<EmailStats[]> {
  const emails = await getDb()
    .select({
      id: automationEmails.id,
      name: automationEmails.name,
      subject: automationEmails.subject,
    })
    .from(automationEmails)
    .where(eq(automationEmails.automationId, automationId))
    .orderBy(asc(automationEmails.position));

  if (emails.length === 0) return [];

  /*
   * One statement for every email, grouped by the node that sent it. The step
   * row carries the node id and the graph maps a node to an email, so the join
   * is `steps → deliveries` and the grouping is by `node_id`.
   */
  const rows = await getDb()
    .select({
      nodeId: automationSteps.nodeId,
      detail: automationSteps.detail,
      status: broadcastDeliveries.status,
      n: sql<string>`count(*)`,
    })
    .from(automationSteps)
    .innerJoin(automationRuns, eq(automationRuns.id, automationSteps.runId))
    .leftJoin(broadcastDeliveries, eq(broadcastDeliveries.id, automationSteps.deliveryId))
    .where(
      and(
        eq(automationRuns.automationId, automationId),
        eq(automationSteps.kind, "send"),
      ),
    )
    .groupBy(automationSteps.nodeId, automationSteps.detail, broadcastDeliveries.status);

  /*
   * `detail` carries the email id for a send step, which is what lets this
   * report per *email* rather than per node — two nodes may send the same
   * email, and a seller reading "open rate" means the message.
   */
  const byEmail = new Map<string, { sent: number; failed: number; suppressed: number }>();
  for (const row of rows) {
    if (!row.detail) continue;
    const bucket = byEmail.get(row.detail) ?? { sent: 0, failed: 0, suppressed: 0 };
    const n = Number(row.n);
    if (row.status === "sent") bucket.sent += n;
    else if (row.status === "suppressed") bucket.suppressed += n;
    else if (row.status === "failed") bucket.failed += n;
    byEmail.set(row.detail, bucket);
  }

  return emails.map((email) => ({
    ...email,
    ...(byEmail.get(email.id) ?? { sent: 0, failed: 0, suppressed: 0 }),
  }));
}

export type RunRow = {
  id: string;
  email: string;
  status: string;
  cursor: string | null;
  wakeAt: Date | null;
  enteredAt: Date;
  finishedAt: Date | null;
  lastError: string | null;
};

export const RUN_LIMIT = 200;

/** The Runs tab: who is in this flow, newest first. */
export async function runsFor(
  automationId: string,
  limit = RUN_LIMIT,
): Promise<RunRow[]> {
  return getDb()
    .select({
      id: automationRuns.id,
      email: automationRuns.email,
      status: automationRuns.status,
      cursor: automationRuns.cursor,
      wakeAt: automationRuns.wakeAt,
      enteredAt: automationRuns.enteredAt,
      finishedAt: automationRuns.finishedAt,
      lastError: automationRuns.lastError,
    })
    .from(automationRuns)
    .where(eq(automationRuns.automationId, automationId))
    .orderBy(desc(automationRuns.enteredAt))
    .limit(limit);
}

export type TimelineStep = {
  nodeId: string;
  kind: string;
  enteredAt: Date;
  leftAt: Date | null;
  outcome: string | null;
  detail: string | null;
};

/**
 * One run's timeline — what makes "why did this contact stop" answerable.
 *
 * The reason the runner writes a row per node rather than looping to
 * completion. Without it, a run that ended at a filter is indistinguishable
 * from one that never started, and the seller's only evidence is an email that
 * did not arrive.
 */
export async function timelineFor(runId: string): Promise<TimelineStep[]> {
  return getDb()
    .select({
      nodeId: automationSteps.nodeId,
      kind: automationSteps.kind,
      enteredAt: automationSteps.enteredAt,
      leftAt: automationSteps.leftAt,
      outcome: automationSteps.outcome,
      detail: automationSteps.detail,
    })
    .from(automationSteps)
    .where(eq(automationSteps.runId, runId))
    .orderBy(asc(automationSteps.enteredAt));
}

/** Every automation a shop has, with its live count, for the list screen. */
export async function automationsFor(shopId: string, kind = "email") {
  const rows = await getDb()
    .select({
      id: automations.id,
      name: automations.name,
      status: automations.status,
      trigger: automations.trigger,
      entryPolicy: automations.entryPolicy,
      activatedAt: automations.activatedAt,
      createdAt: automations.createdAt,
      live: sql<string>`count(${automationRuns.id}) filter (where ${automationRuns.status} in ('queued','waiting'))`,
      total: sql<string>`count(${automationRuns.id})`,
    })
    .from(automations)
    .leftJoin(automationRuns, eq(automationRuns.automationId, automations.id))
    .where(and(eq(automations.shopId, shopId), eq(automations.kind, kind)))
    .groupBy(automations.id)
    .orderBy(desc(automations.createdAt));

  return rows.map((row) => ({
    ...row,
    live: Number(row.live ?? 0),
    total: Number(row.total ?? 0),
  }));
}

/**
 * Cancels every live run of one automation.
 *
 * Used when a seller deletes a flow's *graph* out from under it, and by the
 * scenario suite. Not used by delete — that cascades — and deliberately not by
 * pause, which is the whole point of pause: a paused flow's waiting runs keep
 * their `wake_at` and resume on activation.
 */
export async function cancelLiveRuns(automationId: string): Promise<number> {
  const cancelled = await getDb()
    .update(automationRuns)
    .set({ status: "cancelled", wakeAt: null, finishedAt: new Date() })
    .where(
      and(
        eq(automationRuns.automationId, automationId),
        inArray(automationRuns.status, ["queued", "waiting"]),
      ),
    )
    .returning({ id: automationRuns.id });
  return cancelled.length;
}
