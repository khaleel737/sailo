import "server-only";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  automationRuns,
  automations,
  clients,
  type Automation,
} from "@sailo/db/schema";
import { isTriggerType, REPEAT_FLOOR_MS, type TriggerType } from "./graph";
import { hasOptedOutOfAutomation } from "./unsubscribe";

/**
 * Putting a contact into a flow.
 *
 * **Enrolment is a write, not a poll**, and that is the single most important
 * decision in this file. A cron that scanned for newly-matching contacts would
 * re-enrol everybody the first time any predicate changed — one edit to a
 * segment, and every contact who has ever matched receives the sequence again.
 * So each emit point calls `enrolIfMatching` at the moment the thing happened,
 * and nothing anywhere looks for contacts who "became" eligible.
 *
 * What this function is **not** is an eligibility check for sending. Consent,
 * suppression, the plan flag and the daily ceiling are all asked immediately
 * before each send instead — rule 2 of `lifecycle/steps.ts`, and here it
 * matters more than there: a flow can enrol somebody on Monday and send to
 * them in March, and everything true about them on Monday may have changed.
 * Enrolling a contact who cannot currently be mailed is correct; they may be
 * mailable by the time the first send node is reached.
 */

export type EnrolSubject = {
  /** Lower-cased by the caller or here; every check downstream keys on it. */
  email: string;
  clientId?: string | null;
};

export type EnrolOutcome =
  | { enrolled: true; runId: string }
  | { enrolled: false; reason: "notActive" | "optedOut" | "live" | "once" | "tooSoon" | "noGraph" };

/**
 * Enrols one contact into every active automation of this shop whose trigger
 * matches.
 *
 * Returns what happened per automation, because the emit points log it and
 * because "nothing was enrolled" has five different causes that a seller
 * eventually asks about.
 */
export async function enrolIfMatching(opts: {
  shopId: string;
  trigger: TriggerType;
  subject: EnrolSubject;
  /** The trigger's own payload — a list id, a product id, changed fields. */
  context?: Record<string, unknown>;
  now?: Date;
}): Promise<{ automationId: string; outcome: EnrolOutcome }[]> {
  const now = opts.now ?? new Date();
  const email = opts.subject.email.trim().toLowerCase();
  if (!email) return [];

  const candidates = await getDb().query.automations.findMany({
    where: and(
      eq(automations.shopId, opts.shopId),
      eq(automations.status, "active"),
      /*
       * Scenarios (spec 31) share this table and this runner, and they are
       * enrolled by their own emit points with their own trigger vocabulary.
       * Filtering here rather than at the caller keeps one shop's flows and
       * its scenarios from cross-triggering.
       */
      eq(automations.kind, "email"),
    ),
  });

  const results: { automationId: string; outcome: EnrolOutcome }[] = [];
  for (const automation of candidates) {
    if (!triggerMatches(automation, opts.trigger, opts.context ?? {})) continue;
    results.push({
      automationId: automation.id,
      outcome: await enrol(automation, { ...opts.subject, email }, now),
    });
  }
  return results;
}

/**
 * Whether this automation's trigger is the one that just fired, with the
 * config it was configured for.
 *
 * Pure and total: an unknown trigger type matches nothing rather than
 * everything. A stored row naming a trigger this build has not heard of is a
 * newer deploy's row, and the safe reading of it is "not mine".
 */
function triggerMatches(
  automation: Automation,
  fired: TriggerType,
  context: Record<string, unknown>,
): boolean {
  const trigger = automation.trigger;
  if (!trigger || typeof trigger.type !== "string") return false;
  if (!isTriggerType(trigger.type) || trigger.type !== fired) return false;

  const config = (trigger.config ?? {}) as Record<string, unknown>;

  switch (fired) {
    case "list.joined": {
      const wanted = config.listId;
      // No list configured means any list, which is what the builder's
      // "any list" option writes — an absent value, not a sentinel string.
      return !wanted || wanted === context.listId;
    }

    case "product.purchased": {
      const wanted = config.productIds;
      if (!Array.isArray(wanted) || wanted.length === 0) return true;
      const bought = Array.isArray(context.productIds) ? context.productIds : [];
      return bought.some((id) => wanted.includes(id));
    }

    case "waitlist.signup": {
      const wanted = config.productId;
      return !wanted || wanted === context.productId;
    }

    case "contact.updated": {
      const watched = config.fields;
      if (!Array.isArray(watched) || watched.length === 0) return true;
      const changed = Array.isArray(context.fields) ? context.fields : [];
      return changed.some((field) => watched.includes(field));
    }
  }
}

/**
 * One enrolment, with the two rules that stop a flow becoming a loop.
 *
 * **A live run blocks re-entry**, whatever the policy — enforced by the
 * partial unique index rather than by a read, so two concurrent emits cannot
 * both find nothing and both insert.
 *
 * **`once` means once, ever.** The index cannot say that without also
 * forbidding the re-entry `repeat` exists to allow, so the finished rows are
 * checked here as well. That check *is* a read-then-write, and it is safe
 * because the index closes the race it would otherwise open: two concurrent
 * enrolments cannot both succeed, whatever this read saw.
 *
 * **`repeat` has a floor.** Without one, a `contact.updated` trigger watching
 * a field the flow's own steps write mails somebody hourly for ever.
 * `parseGraph` refuses the most obvious version of that cycle; this is the
 * floor under every version it cannot see.
 */
async function enrol(
  automation: Automation,
  subject: EnrolSubject & { email: string },
  now: Date,
): Promise<EnrolOutcome> {
  const db = getDb();

  if (automation.status !== "active") return { enrolled: false, reason: "notActive" };
  if (!automation.graph) return { enrolled: false, reason: "noGraph" };

  /*
   * The per-automation opt-out, checked here as well as at send time.
   *
   * Not redundant: an opted-out contact who was enrolled anyway would sit in
   * the metrics as a live run that silently never sends, which is the shape of
   * "why did this contact stop" that has no answer. Refusing at the door makes
   * the reason a fact rather than an absence.
   */
  if (await hasOptedOutOfAutomation(automation.id, subject.email)) {
    return { enrolled: false, reason: "optedOut" };
  }

  const previous = await db.query.automationRuns.findFirst({
    where: and(
      eq(automationRuns.automationId, automation.id),
      eq(automationRuns.email, subject.email),
    ),
    orderBy: [desc(automationRuns.enteredAt)],
    columns: { status: true, enteredAt: true },
  });

  if (previous) {
    if (previous.status === "queued" || previous.status === "waiting") {
      return { enrolled: false, reason: "live" };
    }
    if (automation.entryPolicy === "once") return { enrolled: false, reason: "once" };
    if (now.getTime() - previous.enteredAt.getTime() < REPEAT_FLOOR_MS) {
      return { enrolled: false, reason: "tooSoon" };
    }
  }

  /*
   * `entry` comes from the stored graph rather than from `parseGraph`, because
   * enrolment must not be the thing that refuses a graph: the run is created
   * and the *claim* validates, which is where a broken graph fails one run
   * instead of blocking every enrolment into it. A cursor that turns out to
   * point nowhere fails that run with a reason attached.
   */
  const entry = automation.graph.entry ?? automation.graph.nodes?.[0]?.id ?? null;
  if (!entry) return { enrolled: false, reason: "noGraph" };

  const [created] = await db
    .insert(automationRuns)
    .values({
      automationId: automation.id,
      shopId: automation.shopId,
      clientId: subject.clientId ?? null,
      email: subject.email,
      status: "queued",
      cursor: entry,
      // Due immediately. The first node runs on the next tick rather than
      // inline, so an emit point never waits on a send.
      wakeAt: now,
      enteredAt: now,
    })
    /*
     * Lost the race with a concurrent emit — the same contact, the same
     * automation, two events in the same instant. The index refused the second
     * one, which is exactly right, and it is not an error worth surfacing.
     */
    .onConflictDoNothing()
    .returning({ id: automationRuns.id });

  return created
    ? { enrolled: true, runId: created.id }
    : { enrolled: false, reason: "live" };
}

/**
 * The contact behind an address, for the personalisation an enrolment carries.
 *
 * Folded, because `clients.email` is stored as the buyer typed it and every
 * caller here holds a lower-cased address.
 */
export async function clientIdForEmail(
  shopId: string,
  email: string,
): Promise<string | null> {
  const row = await getDb().query.clients.findFirst({
    where: and(
      eq(clients.shopId, shopId),
      sql`lower(${clients.email}) = ${email.toLowerCase()}`,
    ),
    columns: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Pauses every active automation a shop has, preserving its runs.
 *
 * The downgrade path, and it is `paused` rather than `draft` or deleted for
 * the reason the broadcasts rule already gives: a seller who downgrades "gets
 * their drafts back, not their sends". A waiting run keeps its `wake_at` and
 * resumes if they come back — deleting them would mean a seller who
 * downgraded for one month lost every contact mid-sequence, permanently, with
 * no way to tell what had been sent.
 */
export async function pauseAllAutomations(shopId: string): Promise<number> {
  const paused = await getDb()
    .update(automations)
    .set({ status: "paused", updatedAt: new Date() })
    .where(and(eq(automations.shopId, shopId), eq(automations.status, "active")))
    .returning({ id: automations.id });
  return paused.length;
}

/** Runs a tick may pick up, for the metrics screen's "waiting where" counts. */
export async function runCountsByNode(
  automationId: string,
): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({ cursor: automationRuns.cursor, n: sql<string>`count(*)` })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.automationId, automationId),
        inArray(automationRuns.status, ["queued", "waiting"]),
      ),
    )
    .groupBy(automationRuns.cursor);

  return new Map(
    rows.flatMap((row) => (row.cursor ? [[row.cursor, Number(row.n)]] : [])),
  );
}

/** Whether anything is due, for a tick that would otherwise do a full scan. */
export async function anyRunsDue(now = new Date()): Promise<boolean> {
  const row = await getDb().query.automationRuns.findFirst({
    where: and(
      inArray(automationRuns.status, ["queued", "waiting"]),
      gt(sql`${now}`, automationRuns.wakeAt),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}
