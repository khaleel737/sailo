import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  automationEmails,
  automationOptOuts,
  automationRuns,
  automationSteps,
  automations,
  broadcastDeliveries,
  clients,
  shops,
  user,
} from "@sailo/db/schema";
import { suppress } from "@sailo/marketing/broadcasts/server";
import {
  automationUnsubToken,
  enrolIfMatching,
  optOutOfAutomation,
  runAutomationTick,
  timelineFor,
} from "@sailo/marketing/automations/server";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";

/**
 * A contact walking a flow, against real rows.
 *
 * `graph.test.ts` and `timers.test.ts` prove the parts that are pure. This
 * proves the parts that are not, and they are the ones with the expensive
 * failures: whether two ticks can double-send, whether a suppressed address is
 * skipped at *send* time rather than at enrol, whether a quota exhaustion
 * defers or drops, and whether an unsubscribe from one flow really leaves the
 * rest alone.
 *
 * The transport is stubbed at the module boundary — everything else is
 * production code. `runAutomationTick`, the claim, the graph validation, the
 * consent floor and the delivery ledger all run for real.
 *
 * Run with:
 *   npx dotenv -e .env.local.test -- \
 *     npx vitest run --config vitest.scenarios.mts e2e/scenarios/automations.scenario.ts
 */

const outbox = vi.hoisted(() => [] as { to: string; subject: string; headers?: Record<string, string> }[]);
/** Set per test, so a transport failure can be exercised deliberately. */
const transport = vi.hoisted(() => ({ succeeds: true }));

vi.mock("@sailo/mailer/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sailo/mailer/transport")>();
  return {
    ...actual,
    send: async (opts: { to: string; subject: string; headers?: Record<string, string> }) => {
      if (!transport.succeeds) return { sent: false as const, reason: "stubbed failure" };
      outbox.push({ to: opts.to, subject: opts.subject, headers: opts.headers });
      return { sent: true as const, id: `scenario-${outbox.length}` };
    },
  };
});

const db = getDb();
const uid = () => crypto.randomUUID();
const PREFIX = "sc-flows-";

let shopId: string;

async function makeShop(plan = "business"): Promise<string> {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Flow Fixture",
    email: `${PREFIX}${userId}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      name: "Flow Fixture",
      handle: `${PREFIX}${uid().slice(0, 8)}`,
      currency: "USD",
      plan,
      subscriptionStatus: "active",
      timeZone: "Europe/London",
      /*
       * Dated well into the past so the warm-up ramp is over. A shop created
       * today may send only 100 messages, which is plenty for these tests but
       * would make the quota assertions depend on the fixture's age.
       */
      createdAt: new Date(Date.now() - 90 * 86_400_000),
    })
    .returning({ id: shops.id });
  return shop!.id;
}

async function makeContact(email: string, consented = true): Promise<string> {
  const [row] = await db
    .insert(clients)
    .values({
      shopId,
      name: email.split("@")[0]!,
      email,
      source: "subscribe",
      marketingConsentAt: consented ? new Date() : null,
    })
    .returning({ id: clients.id });
  return row!.id;
}

/** A flow: one email, and whatever graph the test needs around it. */
async function makeFlow(opts: {
  graph: unknown;
  status?: string;
  entryPolicy?: string;
  trigger?: unknown;
}): Promise<{ id: string; emailId: string }> {
  const [row] = await db
    .insert(automations)
    .values({
      shopId,
      name: "Welcome",
      kind: "email",
      status: opts.status ?? "active",
      entryPolicy: opts.entryPolicy ?? "once",
      trigger: (opts.trigger ?? { type: "list.joined" }) as never,
      graph: opts.graph as never,
      activatedAt: new Date(),
    })
    .returning({ id: automations.id });

  const [email] = await db
    .insert(automationEmails)
    .values({
      automationId: row!.id,
      name: "Hello",
      subject: "Welcome to {{shop}}",
      bodyMarkdown: "Hello {{first_name}}, thanks for joining.",
    })
    .returning({ id: automationEmails.id });

  return { id: row!.id, emailId: email!.id };
}

/** Rewrites the graph now that the email id is known. */
async function setGraph(automationId: string, graph: unknown) {
  await db
    .update(automations)
    .set({ graph: graph as never })
    .where(eq(automations.id, automationId));
}

const runOf = (automationId: string) =>
  db.query.automationRuns.findFirst({
    where: eq(automationRuns.automationId, automationId),
  });

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures([PREFIX]);
});

beforeEach(async () => {
  outbox.length = 0;
  transport.succeeds = true;
  shopId = await makeShop();
});

describe("enrol → send", () => {
  it("walks a contact from a trigger to a delivered email", async () => {
    const email = `${PREFIX}walk@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(flow.id, {
      nodes: [{ id: "n1", kind: "send", config: { emailId: flow.emailId } }],
      edges: [],
    });

    const enrolled = await enrolIfMatching({
      shopId,
      trigger: "list.joined",
      subject: { email, clientId },
      context: { listId: uid() },
    });
    expect(enrolled[0]?.outcome).toMatchObject({ enrolled: true });

    const result = await runAutomationTick();
    expect(result.sent).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.to).toBe(email);
    // The merge tag was substituted, not left as a token in somebody's inbox.
    expect(outbox[0]?.subject).toBe("Welcome to Flow Fixture");

    // RFC 8058: the pair that makes Gmail's own unsubscribe button work.
    expect(outbox[0]?.headers?.["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );

    // The run finished, and the send landed in the shared delivery ledger.
    const run = await runOf(flow.id);
    expect(run?.status).toBe("done");

    const [delivery] = await db
      .select()
      .from(broadcastDeliveries)
      .where(eq(broadcastDeliveries.shopId, shopId));
    expect(delivery?.status).toBe("sent");
    // No broadcast behind it — the whole reason that column became nullable.
    expect(delivery?.broadcastId).toBeNull();
  });

  it("advances one node per tick and records each as a step", async () => {
    const email = `${PREFIX}steps@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(flow.id, {
      nodes: [
        { id: "n1", kind: "send", config: { emailId: flow.emailId } },
        { id: "n2", kind: "timer", config: { mode: "duration", minutes: 60 } },
        { id: "n3", kind: "send", config: { emailId: flow.emailId } },
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3" },
      ],
    });
    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });

    // First tick: the send. Second: the timer, which parks the run an hour out.
    expect((await runAutomationTick()).sent).toBe(1);
    expect((await runAutomationTick()).waited).toBe(1);

    const run = await runOf(flow.id);
    expect(run?.status).toBe("waiting");
    expect(run?.cursor).toBe("n3");
    // A third tick does nothing, because the run is not due.
    expect((await runAutomationTick()).claimed).toBe(0);
    expect(outbox).toHaveLength(1);

    const timeline = await timelineFor(run!.id);
    expect(timeline.map((s) => [s.nodeId, s.outcome])).toEqual([
      ["n1", "sent"],
      ["n2", "waited"],
    ]);
  });
});

describe("the claim", () => {
  it("lets two concurrent ticks send once", async () => {
    /*
     * The race the lease exists for. Both ticks see a due run; the conditional
     * UPDATE pushes `wake_at` forward, so only one of them claims it.
     */
    const email = `${PREFIX}race@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(flow.id, {
      nodes: [{ id: "n1", kind: "send", config: { emailId: flow.emailId } }],
      edges: [],
    });
    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });

    const [a, b] = await Promise.all([runAutomationTick(), runAutomationTick()]);
    expect(a.claimed + b.claimed).toBe(1);
    expect(outbox).toHaveLength(1);
  });
});

describe("entry policy", () => {
  it("refuses a second enrolment under `once`", async () => {
    const email = `${PREFIX}once@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] }, entryPolicy: "once" });
    await setGraph(flow.id, {
      nodes: [{ id: "n1", kind: "send", config: { emailId: flow.emailId } }],
      edges: [],
    });

    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });
    await runAutomationTick();
    expect((await runOf(flow.id))?.status).toBe("done");

    // Finished, so the live-run index no longer blocks — `once` is what does.
    const second = await enrolIfMatching({
      shopId,
      trigger: "list.joined",
      subject: { email, clientId },
    });
    expect(second[0]?.outcome).toEqual({ enrolled: false, reason: "once" });

    const runs = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.automationId, flow.id));
    expect(runs).toHaveLength(1);
  });

  it("refuses a re-entry while a run is live, whatever the policy", async () => {
    const email = `${PREFIX}live@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({
      graph: { nodes: [], edges: [] },
      entryPolicy: "repeat",
    });
    await setGraph(flow.id, {
      nodes: [{ id: "n1", kind: "timer", config: { mode: "duration", minutes: 10_080 } }],
      edges: [],
    });

    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });
    const second = await enrolIfMatching({
      shopId,
      trigger: "list.joined",
      subject: { email, clientId },
    });
    expect(second[0]?.outcome).toEqual({ enrolled: false, reason: "live" });
  });
});

describe("eligibility, asked at send time", () => {
  it("enrols a suppressed address and then skips the send", async () => {
    /*
     * The order matters and it is the spec's: enrol first, judge later. A
     * suppression that landed *after* enrolment must still stop the send, and
     * the only way to guarantee that is to ask immediately before sending.
     */
    const email = `${PREFIX}supp@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(flow.id, {
      nodes: [{ id: "n1", kind: "send", config: { emailId: flow.emailId } }],
      edges: [],
    });

    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });
    // Enrolled, then they unsubscribe.
    await suppress({ shopId, email, reason: "unsubscribed" });

    const result = await runAutomationTick();
    expect(result.sent).toBe(0);
    expect(outbox).toHaveLength(0);

    const run = await runOf(flow.id);
    const timeline = await timelineFor(run!.id);
    // Recorded as skipped with a reason, so "why did this contact stop" has an
    // answer rather than an absence.
    expect(timeline[0]?.outcome).toBe("skipped");
    expect(timeline[0]?.detail).toContain("suppressed");
  });

  it("skips a contact who never consented", async () => {
    const email = `${PREFIX}noconsent@example.com`;
    const clientId = await makeContact(email, false);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(flow.id, {
      nodes: [{ id: "n1", kind: "send", config: { emailId: flow.emailId } }],
      edges: [],
    });
    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });

    await runAutomationTick();
    expect(outbox).toHaveLength(0);
  });

  it("skips every send for a shop that has downgraded", async () => {
    // The plan is re-read by the tick, not trusted from when the flow was
    // activated. A seller who built six weeks of sequences and downgraded has
    // not bought the right to keep sending them.
    const email = `${PREFIX}downgrade@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(flow.id, {
      nodes: [{ id: "n1", kind: "send", config: { emailId: flow.emailId } }],
      edges: [],
    });
    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });

    await db.update(shops).set({ plan: "free" }).where(eq(shops.id, shopId));

    await runAutomationTick();
    expect(outbox).toHaveLength(0);
    const run = await runOf(flow.id);
    expect((await timelineFor(run!.id))[0]?.detail).toBe("plan");
  });
});

describe("the daily ceiling", () => {
  it("defers rather than dropping, with the cursor unmoved", async () => {
    /*
     * Skipping a step in a funnel is the failure that looks like nothing
     * happened, and it is unrecoverable: the moment for "your order is on its
     * way" does not come round again. So a flow at the ceiling waits.
     */
    const email = `${PREFIX}quota@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(flow.id, {
      nodes: [{ id: "n1", kind: "send", config: { emailId: flow.emailId } }],
      edges: [],
    });
    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });

    // `marketingPausedAt` is the ceiling that does not resolve by waiting, and
    // it is the cheapest of the four to set deterministically.
    await db
      .update(shops)
      .set({ marketingPausedAt: new Date() })
      .where(eq(shops.id, shopId));

    const result = await runAutomationTick();
    expect(result.deferred).toBe(1);
    expect(outbox).toHaveLength(0);

    const run = await runOf(flow.id);
    expect(run?.status).toBe("waiting");
    // Still owed. The cursor has not moved past the send.
    expect(run?.cursor).toBe("n1");
    expect((await timelineFor(run!.id))[0]?.outcome).toBe("deferred");
  });
});

describe("unsubscribing", () => {
  it("stops one flow and leaves the shop's list alone", async () => {
    const email = `${PREFIX}oneflow@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(flow.id, {
      nodes: [
        { id: "n1", kind: "timer", config: { mode: "duration", minutes: 60 } },
        { id: "n2", kind: "send", config: { emailId: flow.emailId } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    });
    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });
    await runAutomationTick();

    // The token is signed, so the link works from a cold mail client.
    expect(automationUnsubToken({ automationId: flow.id, email })).toBeTruthy();
    await optOutOfAutomation({ automationId: flow.id, email });

    // The live run is cancelled — not merely marked, because the next email is
    // the thing the person clicking actually wanted stopped.
    expect((await runOf(flow.id))?.status).toBe("cancelled");

    // And no global suppression was written: they are still on the shop's list.
    const [opt] = await db
      .select()
      .from(automationOptOuts)
      .where(eq(automationOptOuts.automationId, flow.id));
    expect(opt?.email).toBe(email);

    // Re-entry is refused for ever, which is the half that survives a re-add.
    const again = await enrolIfMatching({
      shopId,
      trigger: "list.joined",
      subject: { email, clientId },
    });
    expect(again[0]?.outcome).toEqual({ enrolled: false, reason: "optedOut" });
  });
});

describe("a graph edited under a live run", () => {
  it("fails that run and leaves the tick alive", async () => {
    const doomed = `${PREFIX}doomed@example.com`;
    const fine = `${PREFIX}fine@example.com`;
    const doomedId = await makeContact(doomed);
    const fineId = await makeContact(fine);

    const broken = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(broken.id, {
      nodes: [
        { id: "n1", kind: "timer", config: { mode: "duration", minutes: 1 } },
        { id: "n2", kind: "send", config: { emailId: broken.emailId } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    });
    /*
     * A different trigger, deliberately. `enrolIfMatching` enrols into *every*
     * active automation whose trigger matches, so two flows listening for the
     * same event would each take both contacts — and this test is about one
     * run failing while unrelated work in the same tick completes.
     */
    const healthy = await makeFlow({
      graph: { nodes: [], edges: [] },
      trigger: { type: "waitlist.signup" },
    });
    await setGraph(healthy.id, {
      nodes: [{ id: "h1", kind: "send", config: { emailId: healthy.emailId } }],
      edges: [],
    });

    await enrolIfMatching({
      shopId,
      trigger: "list.joined",
      subject: { email: doomed, clientId: doomedId },
    });
    await runAutomationTick(); // parks the doomed run on `n2`

    // The seller deletes the step the run is standing on.
    await setGraph(broken.id, {
      nodes: [{ id: "n1", kind: "send", config: { emailId: broken.emailId } }],
      edges: [],
    });
    await db
      .update(automationRuns)
      .set({ wakeAt: new Date(Date.now() - 1_000) })
      .where(eq(automationRuns.automationId, broken.id));

    await enrolIfMatching({
      shopId,
      trigger: "waitlist.signup",
      subject: { email: fine, clientId: fineId },
    });

    const result = await runAutomationTick();
    expect(result.failed).toBe(1);
    // The other seller's run went through in the same tick.
    expect(result.sent).toBe(1);
    expect(outbox.map((m) => m.to)).toEqual([fine]);

    const [failed] = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.automationId, broken.id));
    expect(failed?.status).toBe("failed");
    expect(failed?.lastError).toContain("no longer exists");
  });
});

describe("a paused flow", () => {
  it("keeps its waiting runs and resumes them on activation", async () => {
    const email = `${PREFIX}paused@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(flow.id, {
      nodes: [{ id: "n1", kind: "send", config: { emailId: flow.emailId } }],
      edges: [],
    });
    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });

    await db
      .update(automations)
      .set({ status: "paused" })
      .where(eq(automations.id, flow.id));
    await runAutomationTick();
    expect(outbox).toHaveLength(0);
    // Still live, not failed and not cancelled.
    expect((await runOf(flow.id))?.status).toBe("queued");

    await db
      .update(automations)
      .set({ status: "active" })
      .where(eq(automations.id, flow.id));
    await db
      .update(automationRuns)
      .set({ wakeAt: new Date(Date.now() - 1_000) })
      .where(eq(automationRuns.automationId, flow.id));

    expect((await runAutomationTick()).sent).toBe(1);
  });
});

describe("a filter", () => {
  it("stops a non-matching run rather than routing it anywhere", async () => {
    const email = `${PREFIX}filtered@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(flow.id, {
      nodes: [
        {
          id: "f1",
          kind: "filter",
          // Nobody in this fixture carries the tag, so nobody continues.
          config: { segment: { match: "all", rules: [{ type: "tag", value: "vip" }] } },
        },
        { id: "n2", kind: "send", config: { emailId: flow.emailId } },
      ],
      edges: [{ from: "f1", to: "n2" }],
    });
    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });

    await runAutomationTick();
    expect(outbox).toHaveLength(0);

    const run = await runOf(flow.id);
    // `done`, not failed: being filtered out is a normal end to a run.
    expect(run?.status).toBe("done");
    expect((await timelineFor(run!.id))[0]?.outcome).toBe("filtered");
  });
});

describe("a transport failure", () => {
  it("retries rather than losing the message", async () => {
    const email = `${PREFIX}retry@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(flow.id, {
      nodes: [{ id: "n1", kind: "send", config: { emailId: flow.emailId } }],
      edges: [],
    });
    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });

    transport.succeeds = false;
    await runAutomationTick();

    const run = await runOf(flow.id);
    expect(run?.status).toBe("waiting");
    // The cursor has not moved: the message is still owed.
    expect(run?.cursor).toBe("n1");
    expect(run?.lastError).toContain("stubbed failure");

    // The failure is on the ledger too, which is what the reputation pass reads.
    const [delivery] = await db
      .select()
      .from(broadcastDeliveries)
      .where(eq(broadcastDeliveries.shopId, shopId));
    expect(delivery?.status).toBe("failed");

    transport.succeeds = true;
    await db
      .update(automationRuns)
      .set({ wakeAt: new Date(Date.now() - 1_000) })
      .where(eq(automationRuns.id, run!.id));
    expect((await runAutomationTick()).sent).toBe(1);
  });
});

describe("the WhatsApp step", () => {
  it("hands off rather than claiming a send", async () => {
    /*
     * Nobody has sent anything: Sailo composed a message and the seller will
     * press send from their own number. Counting it as `sent` would be
     * claiming delivery on the seller's behalf.
     */
    const email = `${PREFIX}whats@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({ graph: { nodes: [], edges: [] } });
    await setGraph(flow.id, {
      nodes: [
        { id: "w1", kind: "whatsapp", config: { template: "Hi {{first_name}} — it's on its way." } },
      ],
      edges: [],
    });
    await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } });

    await runAutomationTick();
    expect(outbox).toHaveLength(0);

    const run = await runOf(flow.id);
    const timeline = await timelineFor(run!.id);
    expect(timeline[0]?.outcome).toBe("handed_off");
    expect(timeline[0]?.detail).toContain("on its way");
  });
});

describe("the trigger's own configuration", () => {
  it("only enrols for the product it names", async () => {
    const email = `${PREFIX}product@example.com`;
    const clientId = await makeContact(email);
    const wanted = uid();
    const other = uid();

    const flow = await makeFlow({
      graph: { nodes: [], edges: [] },
      trigger: { type: "product.purchased", config: { productIds: [wanted] } },
    });
    await setGraph(flow.id, {
      nodes: [{ id: "n1", kind: "send", config: { emailId: flow.emailId } }],
      edges: [],
    });

    const miss = await enrolIfMatching({
      shopId,
      trigger: "product.purchased",
      subject: { email, clientId },
      context: { productIds: [other] },
    });
    expect(miss).toEqual([]);

    const hit = await enrolIfMatching({
      shopId,
      trigger: "product.purchased",
      subject: { email, clientId },
      // The basket's third item, which is the case a header read would miss.
      context: { productIds: [other, uid(), wanted] },
    });
    expect(hit[0]?.outcome).toMatchObject({ enrolled: true });
  });

  it("does not enrol for a different trigger", async () => {
    const email = `${PREFIX}wrongtrigger@example.com`;
    const clientId = await makeContact(email);
    const flow = await makeFlow({
      graph: { nodes: [], edges: [] },
      trigger: { type: "waitlist.signup" },
    });
    await setGraph(flow.id, {
      nodes: [{ id: "n1", kind: "send", config: { emailId: flow.emailId } }],
      edges: [],
    });

    expect(
      await enrolIfMatching({ shopId, trigger: "list.joined", subject: { email, clientId } }),
    ).toEqual([]);
  });
});
