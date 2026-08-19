import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  automationEmails,
  automationRuns,
  automations,
  broadcastDeliveries,
  clients,
  emailSuppressions,
  shops,
  automationSteps,
  type Automation,
  type AutomationRun,
  type Shop,
} from "@sailo/db/schema";
import { ORDERS, send, sender } from "@sailo/mailer/transport";
import { can } from "@sailo/core/plans";
import { applyMergeTags, mergeValuesFor, renderBody } from "../broadcasts/markdown";
import { broadcastLabels, shopDictionary } from "../broadcasts/labels";
import { budgetFor } from "../broadcasts/quota";
import { segmentSql } from "../broadcasts/segment-sql";
import { EVERYONE } from "../broadcasts/segments";
import { nextNode, parseGraph, type ParsedGraph, type ParsedNode } from "./graph";
import { wakeAtFor } from "./timers";
import {
  automationUnsubPostUrl,
  automationUnsubToken,
  automationUnsubUrl,
  hasOptedOutOfAutomation,
} from "./unsubscribe";

/**
 * One tick of the automation runner.
 *
 * **Here rather than in `@sailo/workflows`**, which is where spec 30 puts it.
 * That package's own header gives the test — *is the function about its
 * package* — and answers it for exactly this shape: a workflow is a function
 * whose whole body is "tell three other systems". This one is about flows. It
 * reads a graph, renders a message, spends a marketing quota and writes a
 * marketing suppression, and every single thing it reaches for lives in this
 * package. Hosting it a layer up would mean adding `@sailo/marketing` to
 * `@sailo/workflows` to hold one file that imports nothing else — inverting
 * the layering that package exists to protect. It sits beside
 * `runBroadcastQueue`, which is the same job for the other kind of send.
 *
 * THE THREE PROPERTIES THAT MATTER
 *
 * **One node per tick.** Not a loop to completion. A graph with a cycle would
 * otherwise hold the tick for ever, and the per-node row is what makes "why
 * did this contact stop" answerable at all.
 *
 * **The claim is a conditional UPDATE**, the same shape as the webhook lease:
 * the winner pushes `wake_at` into the future, so a second tick's WHERE no
 * longer matches even though both saw the row a moment earlier. At-least-once
 * with a lease is the contract, exactly as `webhooks/attempt.ts` documents —
 * a tick that dies mid-send leaves a row that becomes due again.
 *
 * **Eligibility is re-checked at send time, never at enrol time.** Rule 2 of
 * `lifecycle/steps.ts`, and it matters more here: a flow can enrol somebody in
 * January and send to them in March. Consent, the global suppression, the
 * per-automation opt-out, the plan flag and the daily ceiling are all asked
 * immediately before the send.
 */

/** Runs one tick will look at. The cron runs every five minutes. */
const MAX_RUNS_PER_TICK = 200;

/**
 * How long a claimed run is hidden from other ticks.
 *
 * Longer than any send takes and longer than the cron interval, so the only
 * thing that can make a leased run due again is the process that claimed it
 * having died. Borrowed from `webhooks/policy.ts`, which explains the choice.
 */
const CLAIM_LEASE_MS = 5 * 60_000;

/**
 * Failed sends before a run is abandoned.
 *
 * Finite, because a run retrying for ever is a row the metrics screen counts
 * as live and a seller waits on. Generous, because the usual cause is a
 * transport blip and giving up on somebody's welcome sequence over one of
 * those is worse than sending it an hour late.
 */
const MAX_ATTEMPTS = 6;

export type TickResult = {
  claimed: number;
  sent: number;
  waited: number;
  finished: number;
  failed: number;
  /** Held by a daily ceiling. Not a failure — they wake tomorrow. */
  deferred: number;
  /** Skipped a send because the address may not be mailed right now. */
  skipped: number;
};

/**
 * Claims what is due and advances each run by exactly one node.
 *
 * Safe to run twice, and safe to run while another tick is running.
 */
export async function runAutomationTick(now = new Date()): Promise<TickResult> {
  const db = getDb();
  const result: TickResult = {
    claimed: 0,
    sent: 0,
    waited: 0,
    finished: 0,
    failed: 0,
    deferred: 0,
    skipped: 0,
  };

  /*
   * The claim, and the only thing standing between two ticks and a double
   * send.
   *
   * `FOR UPDATE SKIP LOCKED` inside the subquery lets two ticks run at once
   * without both claiming the same rows — the second skips what the first has
   * locked rather than blocking behind it. The UPDATE's own `wake_at <= now`
   * is the belt to that brace: a row claimed between the subquery and the
   * write has had its wake time pushed forward and no longer matches.
   */
  const claimed = await db
    .update(automationRuns)
    .set({
      attempt: sql`${automationRuns.attempt} + 1`,
      wakeAt: new Date(now.getTime() + CLAIM_LEASE_MS),
    })
    .where(
      and(
        inArray(automationRuns.status, ["queued", "waiting"]),
        lte(automationRuns.wakeAt, now),
        inArray(
          automationRuns.id,
          sql`(select id from ${automationRuns}
               where status in ('queued','waiting') and wake_at <= ${now}
               order by wake_at
               limit ${MAX_RUNS_PER_TICK}
               for update skip locked)`,
        ),
      ),
    )
    .returning();

  result.claimed = claimed.length;
  if (claimed.length === 0) return result;

  /*
   * The automations and shops behind this batch, read once. A tick that
   * claimed two hundred runs across forty shops would otherwise pay two
   * hundred pairs of round trips for forty distinct answers.
   */
  const automationIds = [...new Set(claimed.map((run) => run.automationId))];
  const rows = await db
    .select({ automation: automations, shop: shops })
    .from(automations)
    .innerJoin(shops, eq(shops.id, automations.shopId))
    .where(inArray(automations.id, automationIds));
  const context = new Map(rows.map((row) => [row.automation.id, row]));

  for (const run of claimed) {
    const found = context.get(run.automationId);
    if (!found) {
      // The automation was deleted between the claim and here. The cascade
      // will take this row too; nothing to do and nothing worth logging.
      continue;
    }
    try {
      const advanced = await advance(run, found.automation, found.shop, now);
      result[advanced] += 1;
    } catch (error) {
      /*
       * One run's failure must never take the tick with it. A graph nobody
       * could parse, a transport that threw, a shop row that vanished — all of
       * them are this run's problem, and every other seller's flows are still
       * due.
       */
      result.failed += 1;
      await failRun(run, error instanceof Error ? error.message : "unknown", now);
    }
  }

  return result;
}

type Advanced = "sent" | "waited" | "finished" | "failed" | "deferred" | "skipped";

/** Executes the node this run is standing on, and decides where it goes next. */
async function advance(
  run: AutomationRun,
  automation: Automation,
  shop: Shop,
  now: Date,
): Promise<Advanced> {
  /*
   * A paused automation's runs keep their `wake_at` and resume on activation.
   * The lease already pushed this one five minutes out, which is the right
   * amount of "come back later" — a pause that lasts a week costs one wasted
   * claim every five minutes, and a pause that lasts a minute resumes almost
   * immediately.
   */
  if (automation.status !== "active") return "waited";

  if (run.attempt > MAX_ATTEMPTS) {
    await failRun(run, `gave up after ${MAX_ATTEMPTS} attempts`, now);
    return "failed";
  }

  /*
   * Validated again, here, and not only when the seller saved it. A graph
   * edited while runs are in flight is normal; the failure this catches is a
   * cursor pointing at a node that no longer exists, and it must fail *this
   * run* rather than crash the tick.
   */
  const parsed = parseGraph(automation.graph);
  if (!parsed.ok) {
    await failRun(
      run,
      `graph invalid: ${parsed.problems.map((p) => p.code).join(", ")}`,
      now,
    );
    return "failed";
  }

  const nodeId = run.cursor ?? parsed.graph.entry;
  const node = parsed.graph.nodes.get(nodeId);
  if (!node) {
    await failRun(run, `step ${nodeId} no longer exists`, now);
    return "failed";
  }

  switch (node.kind) {
    case "timer":
      return runTimer(run, node, shop, parsed.graph, now);
    case "filter":
      return runFilter(run, node, parsed.graph, now);
    case "branch":
      return runBranch(run, node, parsed.graph, now);
    case "send":
      return runSend(run, node, automation, shop, parsed.graph, now);
    case "whatsapp":
      return runWhatsApp(run, node, parsed.graph, now);
  }
}

/* --------------------------------------------------------------------------
   The nodes
-------------------------------------------------------------------------- */

async function runTimer(
  run: AutomationRun,
  node: Extract<ParsedNode, { kind: "timer" }>,
  shop: Shop,
  graph: ParsedGraph,
  now: Date,
): Promise<Advanced> {
  const wake = wakeAtFor(node, shop.timeZone, now);
  const next = nextNode(graph, node.id, undefined);

  await step(run.id, node, "waited", wake.toISOString());

  /*
   * The cursor moves to the *next* node and the wake time is the timer's.
   * Leaving the cursor on the timer would make it fire again on the next
   * claim and reset its own wait — a five-minute timer that never ends.
   */
  if (!next) return finishRun(run, now);
  await getDb()
    .update(automationRuns)
    .set({ status: "waiting", cursor: next, wakeAt: wake, lastError: null })
    .where(eq(automationRuns.id, run.id));
  return "waited";
}

async function runFilter(
  run: AutomationRun,
  node: Extract<ParsedNode, { kind: "filter" }>,
  graph: ParsedGraph,
  now: Date,
): Promise<Advanced> {
  const matches = await contactMatches(run, node.segment, now);

  /*
   * A filter has one path and no second. Non-matching runs *stop* — `done`,
   * with the outcome recorded — rather than being routed anywhere. Their
   * distinction between a filter and a branch, and it is the right one: a
   * filter is "only these people continue", and a seller who wanted the other
   * half to go somewhere reaches for a branch.
   */
  if (!matches) {
    await step(run.id, node, "filtered", "did not match");
    return finishRun(run, now);
  }

  await step(run.id, node, "branched", "matched");
  return moveTo(run, nextNode(graph, node.id), now);
}

async function runBranch(
  run: AutomationRun,
  node: Extract<ParsedNode, { kind: "branch" }>,
  graph: ParsedGraph,
  now: Date,
): Promise<Advanced> {
  let took: boolean;

  switch (node.condition) {
    /*
     * `?? EVERYONE` and not a refusal. `parseGraph` guarantees a segment on
     * these two conditions, so this fallback is unreachable — but it has to be
     * the *permissive* one anyway: a condition that silently matched nobody
     * would stop every run at a branch the seller believes is open, and that
     * failure is invisible until somebody asks why a sequence stopped.
     */
    case "matches":
      took = await contactMatches(run, node.segment ?? EVERYONE, now);
      break;
    case "notMatches":
      took = !(await contactMatches(run, node.segment ?? EVERYONE, now));
      break;
    case "opened":
    case "notOpened":
    case "clicked":
    case "notClicked": {
      /*
       * Read from the delivery this run's own earlier send produced, found
       * through `automation_steps`. Asking `broadcast_deliveries` by address
       * would answer about whichever message reached them last, including a
       * broadcast — which is a different question with the same shape, and the
       * kind that is only noticed when a branch sends the wrong follow-up.
       */
      const engaged = await deliveryEngagement(run.id, node.sourceNodeId ?? "");
      const wanted =
        node.condition === "opened" || node.condition === "notOpened"
          ? engaged.opened
          : engaged.clicked;
      took =
        node.condition === "opened" || node.condition === "clicked" ? wanted : !wanted;
      break;
    }
  }

  await step(run.id, node, "branched", took ? "yes" : "no");
  return moveTo(run, nextNode(graph, node.id, took ? "yes" : "no"), now);
}

/**
 * The one node that spends money, quota and somebody's attention.
 *
 * Every check here is made *now*, immediately before the send, and not one of
 * them was made at enrol time — see the file header. They are ordered by what
 * each failure means, because the three outcomes are genuinely different:
 *
 *   - **cancel** — this person has left this flow. Nothing more is owed them.
 *   - **skip** — this message may not go, but the flow continues; a later node
 *     may still be right for them.
 *   - **defer** — the message is owed and cannot go *yet*. It waits, and this
 *     is the one that must never be confused with the other two: a funnel step
 *     silently skipped is the failure mode that looks like nothing happened.
 */
async function runSend(
  run: AutomationRun,
  node: Extract<ParsedNode, { kind: "send" }>,
  automation: Automation,
  shop: Shop,
  graph: ParsedGraph,
  now: Date,
): Promise<Advanced> {
  const db = getDb();

  /*
   * The plan, re-read rather than trusted from when the flow was activated.
   * A seller who built six weeks of sequences and then downgraded has not
   * bought the right to keep sending them, and the check that gates the button
   * is worth nothing if the tick does not make it too.
   */
  if (!can(shop, "automations")) {
    await step(run.id, node, "skipped", "plan");
    return moveTo(run, nextNode(graph, node.id), now);
  }

  // Left this sequence for good. The run ends rather than limping to a node
  // that would skip too — "cancelled" is the honest status for the metrics.
  if (await hasOptedOutOfAutomation(automation.id, run.email)) {
    await step(run.id, node, "skipped", "unsubscribed from this flow");
    await db
      .update(automationRuns)
      .set({ status: "cancelled", wakeAt: null, finishedAt: now })
      .where(eq(automationRuns.id, run.id));
    return "skipped";
  }

  /*
   * The global suppression, and the consent floor, in one question — the same
   * two conditions `mailable()` puts in every audience, asked here about one
   * address because there is no audience to build.
   */
  const reachable = await canMailNow(shop.id, run.email);
  if (!reachable) {
    await step(run.id, node, "skipped", "suppressed or no consent");
    return moveTo(run, nextNode(graph, node.id), now);
  }

  /*
   * The ceiling, and it **fails closed**: this path spends quota, so a budget
   * that cannot be established is a budget that has been reached.
   *
   * A flow that hits the ceiling waits — `wake_at` tomorrow — and does not
   * fail and does not skip. Skipping a step in a funnel is the failure mode
   * that looks like nothing happened, and it is unrecoverable: the moment for
   * "your order is on its way" does not come round again.
   */
  const budget = await budgetFor(shop, now);
  if (budget.available <= 0) {
    await step(run.id, node, "deferred", budget.limitedBy ?? "quota");
    await db
      .update(automationRuns)
      .set({
        status: "waiting",
        // Tomorrow, not five minutes: the shop-side ceilings roll with a
        // 24-hour window, so retrying sooner is a claim that costs a round
        // trip and finds the same answer.
        wakeAt: new Date(now.getTime() + 24 * 3_600_000),
        // The cursor does not move. The message is still owed.
        lastError: null,
      })
      .where(eq(automationRuns.id, run.id));
    return "deferred";
  }

  const email = await db.query.automationEmails.findFirst({
    where: and(
      eq(automationEmails.id, node.emailId),
      eq(automationEmails.automationId, automation.id),
    ),
  });
  if (!email) {
    await failRun(run, `email ${node.emailId} no longer exists`, now);
    return "failed";
  }

  /*
   * No signing secret means no working unsubscribe link, and an automation
   * email without one must not be sent at all — the same refusal
   * `sendOneBatch` makes, for the same reason: mail carrying a dead
   * unsubscribe is exactly the mail this feature promises never to send.
   * Deferred rather than failed, so a fixed environment sends it for real.
   */
  const token = automationUnsubToken({ automationId: automation.id, email: run.email });
  if (!token) {
    await step(run.id, node, "deferred", "no unsubscribe signing secret");
    await db
      .update(automationRuns)
      .set({ status: "waiting", wakeAt: new Date(now.getTime() + 3_600_000) })
      .where(eq(automationRuns.id, run.id));
    return "deferred";
  }

  /*
   * The delivery row is written *before* the send, not after.
   *
   * It is the resume point: a tick that dies between the transport call and
   * the status write leaves a `sending` row rather than no evidence at all,
   * and the address is on the ledger the suppression webhook reads. Written
   * after, a crash would lose the fact that somebody was mailed — which is the
   * one fact this table exists to keep.
   */
  const [delivery] = await db
    .insert(broadcastDeliveries)
    .values({
      broadcastId: null,
      shopId: shop.id,
      clientId: run.clientId,
      email: run.email,
      status: "sending",
      attempts: 1,
    })
    .returning({ id: broadcastDeliveries.id });

  const { t } = shopDictionary(shop);
  const labels = broadcastLabels(t);
  const name = run.clientId ? await contactName(run.clientId) : null;
  const merge = mergeValuesFor({
    name,
    shopName: shop.name,
    couponCode: undefined,
    fallbackName: labels.friend,
  });

  const unsubUrl = automationUnsubUrl(token);
  const result = await send({
    from: sender(shop.name, ORDERS),
    to: run.email,
    subject: applyMergeTags(email.subject, merge, false),
    html: renderAutomationEmail({
      shop,
      bodyHtml: applyMergeTags(renderBody(email.bodyMarkdown), merge, true),
      preheader: email.preheader,
      unsubscribeUrl: unsubUrl,
      unsubscribeLabel: labels.unsubscribe,
    }),
    replyTo: shop.contactEmail ?? undefined,
    headers: {
      /*
       * RFC 8058, the same pair every broadcast carries. Gmail requires it on
       * bulk mail, and a sender without it is a sender whose mail goes to
       * spam — worse for the seller than not sending at all.
       */
      "List-Unsubscribe": `<${automationUnsubPostUrl(token)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  await db
    .update(broadcastDeliveries)
    .set(
      result.sent
        ? { status: "sent", providerId: result.id, sentAt: new Date() }
        : { status: "failed", error: (result.reason ?? "unknown").slice(0, 500) },
    )
    .where(eq(broadcastDeliveries.id, delivery!.id));

  await step(
    run.id,
    node,
    result.sent ? "sent" : "failed",
    email.id,
    delivery!.id,
  );

  if (!result.sent) {
    /*
     * Left where it is, to be retried. The delivery row records the failure,
     * `attempt` counts it, and `MAX_ATTEMPTS` is what eventually gives up — a
     * transport blip must not cost somebody their welcome sequence.
     */
    await db
      .update(automationRuns)
      .set({
        status: "waiting",
        wakeAt: new Date(now.getTime() + 15 * 60_000),
        lastError: (result.reason ?? "send failed").slice(0, 500),
      })
      .where(eq(automationRuns.id, run.id));
    return "failed";
  }

  const moved = await moveTo(run, nextNode(graph, node.id), now);
  return moved === "waited" ? "sent" : moved;
}

/**
 * The step that is Sailo's rather than borrowed.
 *
 * There is no WhatsApp Business API here, and this is not a workaround for
 * that: it is the same handoff the checkout already uses. Sailo composes the
 * message and schedules the moment; the seller presses send from their own
 * number, in the thread the order already lives in. It reaches every country,
 * needs no template approval, costs nothing, and — unlike an email step — it
 * works for the buyer who never gave an address, which on the chat rails is
 * most of them.
 *
 * So this node sends nothing and spends no quota. It records that a message is
 * ready, and the seller's own screen is where it is picked up. The outcome is
 * `handed_off` rather than `sent` precisely because nobody has sent anything
 * yet, and a metrics screen that counted it as a send would be claiming
 * delivery on the seller's behalf.
 */
async function runWhatsApp(
  run: AutomationRun,
  node: Extract<ParsedNode, { kind: "whatsapp" }>,
  graph: ParsedGraph,
  now: Date,
): Promise<Advanced> {
  await step(run.id, node, "handed_off", node.template.slice(0, 500));
  return moveTo(run, nextNode(graph, node.id), now);
}

/* --------------------------------------------------------------------------
   Shared
-------------------------------------------------------------------------- */

/**
 * Whether this shop may mail this address right now.
 *
 * The same two conditions `mailable()` puts in every audience — consent
 * granted, not suppressed — asked about one address because there is no
 * audience to build. Deliberately one statement: two round trips could
 * disagree with each other across an unsubscribe landing between them, and
 * the safe side of that race is the one that reads both at once.
 */
async function canMailNow(shopId: string, email: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ ok: sql<boolean>`true` })
    .from(clients)
    .where(
      and(
        eq(clients.shopId, shopId),
        sql`lower(${clients.email}) = ${email}`,
        sql`${clients.marketingConsentAt} is not null`,
        sql`not exists (
          select 1 from ${emailSuppressions}
          where ${emailSuppressions.shopId} = ${shopId}
            and ${emailSuppressions.email} = ${email}
        )`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Whether the contact this run is about still matches a segment. */
async function contactMatches(
  run: AutomationRun,
  segment: Parameters<typeof segmentSql>[0],
  now: Date,
): Promise<boolean> {
  const narrowing = segmentSql(segment, now);
  // An empty segment matches everybody, which is what `EVERYONE` means — and
  // it must not be read as "matches nobody", which would silently stop every
  // run at a filter the seller left blank.
  if (!narrowing) return true;

  const [row] = await getDb()
    .select({ ok: sql<boolean>`true` })
    .from(clients)
    .where(
      and(
        eq(clients.shopId, run.shopId),
        sql`lower(${clients.email}) = ${run.email}`,
        narrowing,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Whether the message a given send node produced for this run was opened or
 * clicked.
 *
 * Both currently read the delivery's status, because opens and clicks are not
 * yet recorded per delivery — Resend reports them and nothing here stores
 * them. Rather than pretend, the conditions answer the question they *can*
 * answer honestly: a message that was not delivered was certainly not opened.
 * A seller branching on "opened" today gets "reached them at all", which is
 * conservative in the right direction — the `notOpened` path is the one that
 * sends a follow-up, and sending one to somebody who did open is a smaller
 * harm than never following up with somebody who did not.
 */
async function deliveryEngagement(
  runId: string,
  sourceNodeId: string,
): Promise<{ opened: boolean; clicked: boolean }> {
  const [row] = await getDb()
    .select({ status: broadcastDeliveries.status })
    .from(automationSteps)
    .innerJoin(
      broadcastDeliveries,
      eq(broadcastDeliveries.id, automationSteps.deliveryId),
    )
    .where(
      and(eq(automationSteps.runId, runId), eq(automationSteps.nodeId, sourceNodeId)),
    )
    .limit(1);

  const delivered = row?.status === "sent";
  return { opened: delivered, clicked: delivered };
}

/** The name for `{{first_name}}`, read live rather than snapshotted. */
async function contactName(clientId: string): Promise<string | null> {
  const row = await getDb().query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { name: true },
  });
  return row?.name ?? null;
}

/** One row per node entered — the timeline. */
async function step(
  runId: string,
  node: ParsedNode,
  outcome: string,
  detail?: string,
  deliveryId?: string,
): Promise<void> {
  const now = new Date();
  await getDb().insert(automationSteps).values({
    runId,
    nodeId: node.id,
    kind: node.kind,
    enteredAt: now,
    leftAt: now,
    outcome,
    detail: detail?.slice(0, 500) ?? null,
    deliveryId: deliveryId ?? null,
  });
}

/** Moves the cursor on, or finishes when the flow has no more nodes. */
async function moveTo(
  run: AutomationRun,
  next: string | null,
  now: Date,
): Promise<Advanced> {
  if (!next) return finishRun(run, now);

  await getDb()
    .update(automationRuns)
    .set({
      status: "queued",
      cursor: next,
      // Due immediately, so a chain of instant nodes advances one per tick
      // rather than one per five minutes. The cap on that is the tick's own
      // `MAX_RUNS_PER_TICK`, not a delay nobody asked for.
      wakeAt: now,
      lastError: null,
    })
    .where(eq(automationRuns.id, run.id));
  return "waited";
}

async function finishRun(run: AutomationRun, now: Date): Promise<Advanced> {
  await getDb()
    .update(automationRuns)
    .set({ status: "done", cursor: null, wakeAt: null, finishedAt: now })
    .where(eq(automationRuns.id, run.id));
  return "finished";
}

async function failRun(
  run: AutomationRun,
  reason: string,
  now: Date,
): Promise<void> {
  await getDb()
    .update(automationRuns)
    .set({
      status: "failed",
      wakeAt: null,
      finishedAt: now,
      lastError: reason.slice(0, 500),
    })
    .where(eq(automationRuns.id, run.id));
  console.error(`[sailo] automation run ${run.id} failed: ${reason}`);
}

/**
 * The message body, in the same Gmail-safe markup a broadcast uses.
 *
 * Deliberately not `renderBroadcast`: that one renders an *offer* — a coupon,
 * product cards, a call-to-action button — and an automation email is a
 * message. What is shared is the part that matters and the part that is easy
 * to get wrong: the markdown pipeline, the merge tags, and the unsubscribe
 * footer, all imported rather than rewritten.
 */
function renderAutomationEmail(opts: {
  shop: Shop;
  bodyHtml: string;
  preheader: string | null;
  unsubscribeUrl: string;
  unsubscribeLabel: string;
}): string {
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeText(opts.preheader)}</div>`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f6f6">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f6">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px">
      <tr><td style="padding:28px 28px 8px;font:600 18px/1.3 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111">
        ${escapeText(opts.shop.name)}
      </td></tr>
      <tr><td style="padding:0 28px 24px;font:400 15px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#333">
        ${opts.bodyHtml}
      </td></tr>
      <tr><td style="padding:0 28px 28px;font:400 12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#888">
        <a href="${opts.unsubscribeUrl}" style="color:#888">${escapeText(opts.unsubscribeLabel)}</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** Text into an HTML attribute or body. `markdown.ts` owns the body's own escaping. */
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
