import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  automationRuns,
  automations,
  automationSteps,
  clients,
  integrationApps,
  shops,
  user,
} from "@sailo/db/schema";
import { sealSecret } from "@sailo/core/secret-box";
import { compileScenario } from "@sailo/marketing/automations";
import {
  enrolIfMatching,
  runAutomationTick,
  timelineFor,
} from "@sailo/marketing/automations/server";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";

/**
 * A scenario, running on the flow runner — spec 31.
 *
 * The claim this file exists to check is the one the whole spec rests on:
 * **a scenario is a two-node graph, and the runner spec 30 already built walks
 * it.** If that were not true, spec 31 would be a second scheduler with a
 * second retry policy and a second way to send the same request twice.
 *
 * `postWebhook` is stubbed at the module boundary — it reaches a network this
 * fixture has none of. Everything else is production code: the compiler, the
 * claim, the action dispatch, the credential and the failure counter.
 *
 * Run with:
 *   npx dotenv -e .env.local.test -- \
 *     npx vitest run --config vitest.scenarios.mts e2e/scenarios/integrations.scenario.ts
 */

const posts = vi.hoisted(
  () => [] as { url: string; body: string; headers: Record<string, string> }[],
);
const endpoint = vi.hoisted(() => ({ ok: true, status: 200 }));

vi.mock("@sailo/webhooks/post", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sailo/webhooks/post")>();
  return {
    ...actual,
    postWebhook: async (opts: {
      url: string;
      body: string;
      headers: Record<string, string>;
    }) => {
      posts.push(opts);
      return endpoint.ok
        ? { ok: true as const, status: endpoint.status }
        : { ok: false as const, status: endpoint.status, reason: "stubbed failure" };
    },
  };
});

const mails = vi.hoisted(() => [] as { to: string; subject: string }[]);

vi.mock("@sailo/mailer/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sailo/mailer/transport")>();
  return {
    ...actual,
    send: async (opts: { to: string; subject: string }) => {
      mails.push({ to: opts.to, subject: opts.subject });
      return { sent: true as const, id: `scenario-${mails.length}` };
    },
  };
});

const db = getDb();
const uid = () => crypto.randomUUID();
const PREFIX = "sc-integrations-";

let shopId: string;

async function makeShop(plan = "business"): Promise<string> {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Scenario Fixture",
    email: `${PREFIX}${userId}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      name: "Scenario Fixture",
      handle: `${PREFIX}${uid().slice(0, 8)}`,
      currency: "USD",
      plan,
      subscriptionStatus: "active",
      notificationEmail: `${PREFIX}seller@example.com`,
      createdAt: new Date(Date.now() - 90 * 86_400_000),
    })
    .returning({ id: shops.id });
  return shop!.id;
}

async function makeApp(over: Record<string, unknown> = {}): Promise<string> {
  const [row] = await db
    .insert(integrationApps)
    .values({
      shopId,
      label: `App ${uid().slice(0, 6)}`,
      kind: "http",
      baseUrl: "https://hooks.example.com/inbound",
      secretCiphertext: sealSecret("sk_live_abcd1234"),
      secretHint: "••••1234",
      headerName: "X-Api-Key",
      ...over,
    })
    .returning({ id: integrationApps.id });
  return row!.id;
}

/** A scenario, compiled and stored — the path the seller's form takes. */
async function makeScenario(spec: Parameters<typeof compileScenario>[0]) {
  const compiled = compileScenario(spec);
  if (!compiled.ok) throw new Error(`compile failed: ${compiled.problems.join(", ")}`);

  const [row] = await db
    .insert(automations)
    .values({
      shopId,
      name: "When someone buys",
      kind: "scenario",
      status: "active",
      entryPolicy: "repeat",
      trigger: compiled.trigger as never,
      graph: compiled.graph as never,
      activatedAt: new Date(),
    })
    .returning({ id: automations.id });
  return row!.id;
}

async function makeContact(email: string): Promise<string> {
  const [row] = await db
    .insert(clients)
    .values({ shopId, name: "Buyer", email, source: "order" })
    .returning({ id: clients.id });
  return row!.id;
}

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures([PREFIX]);
});

beforeEach(async () => {
  posts.length = 0;
  mails.length = 0;
  endpoint.ok = true;
  endpoint.status = 200;
  shopId = await makeShop();
});

describe("a scenario runs on the flow runner", () => {
  it("posts to the seller's endpoint with their key in their header", async () => {
    const appId = await makeApp();
    const scenarioId = await makeScenario({
      trigger: "product.purchased",
      action: "http.request",
      appId,
    });
    const email = `${PREFIX}buyer@example.com`;
    await makeContact(email);

    await enrolIfMatching({
      shopId,
      trigger: "product.purchased",
      subject: { email },
      context: { productIds: [uid()] },
      kinds: ["scenario"],
    });

    /*
     * The same tick spec 30 built. No second scheduler.
     *
     * Asserted on what this test owns rather than on `claimed`: the tick is
     * fleet-wide by design, so a run another suite left due is counted too and
     * a `toBe(1)` here would fail for a reason that has nothing to do with
     * scenarios.
     */
    const result = await runAutomationTick();
    expect(result.claimed).toBeGreaterThanOrEqual(1);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe("https://hooks.example.com/inbound");
    // The header the seller named, carrying the key we sealed.
    expect(posts[0]?.headers["x-api-key"]).toBe("sk_live_abcd1234");

    // The payload is a notification, not a data dump: what happened and to
    // whom, and the consumer fetches the rest with their own key.
    const body = JSON.parse(posts[0]!.body);
    expect(body.contact.email).toBe(email);
    expect(body.scenario.id).toBe(scenarioId);

    const run = await db.query.automationRuns.findFirst({
      where: eq(automationRuns.automationId, scenarioId),
    });
    expect(run?.status).toBe("done");

    // The execution log records the status and the type, and never the body.
    const [step] = await db
      .select()
      .from(automationSteps)
      .where(eq(automationSteps.runId, run!.id));
    expect(step?.responseStatus).toBe(200);
    expect(step?.outcome).toBe("sent");
  });

  it("waits the configured days before acting", async () => {
    /*
     * Their second example — "3 days after subscription expiration, remove the
     * customer" — and the whole reason to share the runner: "after" is the
     * `timer` node spec 30 already built.
     */
    const appId = await makeApp();
    const scenarioId = await makeScenario({
      trigger: "subscription.expired",
      action: "http.request",
      appId,
      delayDays: 3,
    });
    const email = `${PREFIX}lapsed@example.com`;
    await makeContact(email);
    await enrolIfMatching({
      shopId,
      trigger: "subscription.expired",
      subject: { email },
      kinds: ["scenario"],
    });

    // First tick: the timer parks it three days out. Nothing posted.
    await runAutomationTick();
    expect(posts).toHaveLength(0);

    const run = await db.query.automationRuns.findFirst({
      where: eq(automationRuns.automationId, scenarioId),
    });
    expect(run?.status).toBe("waiting");
    expect(run?.wakeAt!.getTime() - Date.now()).toBeGreaterThan(2.9 * 86_400_000);

    // Wound forward, it posts.
    await db
      .update(automationRuns)
      .set({ wakeAt: new Date(Date.now() - 1_000) })
      .where(eq(automationRuns.id, run!.id));
    await runAutomationTick();
    expect(posts).toHaveLength(1);
  });
});

describe("email.notify", () => {
  it("mails the shop's own address and cannot be pointed elsewhere", async () => {
    /*
     * The destination is read from the shop row and is not a field of the
     * action. An action that mailed an arbitrary address would be an open
     * relay wearing a scenario's clothes — with our sending domain behind it.
     */
    const scenarioId = await makeScenario({
      trigger: "order.paid",
      action: "email.notify",
    });
    const email = `${PREFIX}buyer2@example.com`;
    await makeContact(email);
    await enrolIfMatching({
      shopId,
      trigger: "order.paid",
      subject: { email },
      kinds: ["scenario"],
    });

    await runAutomationTick();
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe(`${PREFIX}seller@example.com`);
    // Not the buyer. There is no configuration that would make it the buyer.
    expect(mails[0]?.to).not.toBe(email);
    expect(scenarioId).toBeTruthy();
  });
});

describe("contact.tag", () => {
  it("tags an existing buyer and is idempotent", async () => {
    await makeScenario({ trigger: "order.paid", action: "contact.tag", tag: "repeat-buyer" });
    const email = `${PREFIX}tagme@example.com`;
    const clientId = await makeContact(email);

    for (let i = 0; i < 2; i += 1) {
      await enrolIfMatching({
        shopId,
        trigger: "order.paid",
        subject: { email },
        kinds: ["scenario"],
      });
      await runAutomationTick();
      // `repeat` needs a live run to finish before re-entry; the floor is what
      // stops a third, so two rounds is what this fixture can exercise.
      await db
        .update(automationRuns)
        .set({ enteredAt: new Date(Date.now() - 2 * 86_400_000) })
        .where(eq(automationRuns.shopId, shopId));
    }

    const [row] = await db.select().from(clients).where(eq(clients.id, clientId));
    // Once, not twice — `array_append` guarded by a containment check.
    expect(row?.tags).toEqual(["repeat-buyer"]);
  });

  it("fails visibly rather than inventing a contact", async () => {
    /*
     * A tag on a row nobody meant to exist is a contact that appeared in the
     * seller's audience from a scenario, and they would never find out where
     * it came from.
     */
    const scenarioId = await makeScenario({
      trigger: "order.paid",
      action: "contact.tag",
      tag: "ghost",
    });
    const email = `${PREFIX}nobody@example.com`;
    await enrolIfMatching({
      shopId,
      trigger: "order.paid",
      subject: { email },
      kinds: ["scenario"],
    });

    await runAutomationTick();

    const run = await db.query.automationRuns.findFirst({
      where: eq(automationRuns.automationId, scenarioId),
    });
    const timeline = await timelineFor(run!.id);
    expect(timeline[0]?.outcome).toBe("failed");
    expect(timeline[0]?.detail).toContain("no contact");

    const created = await db
      .select()
      .from(clients)
      .where(and(eq(clients.shopId, shopId), eq(clients.email, email)));
    expect(created).toEqual([]);
  });
});

describe("a failing endpoint", () => {
  it("retries rather than losing the scenario, and counts the failure", async () => {
    const appId = await makeApp();
    const scenarioId = await makeScenario({
      trigger: "order.paid",
      action: "http.request",
      appId,
    });
    const email = `${PREFIX}flaky@example.com`;
    await makeContact(email);
    await enrolIfMatching({
      shopId,
      trigger: "order.paid",
      subject: { email },
      kinds: ["scenario"],
    });

    endpoint.ok = false;
    endpoint.status = 500;
    await runAutomationTick();

    const run = await db.query.automationRuns.findFirst({
      where: eq(automationRuns.automationId, scenarioId),
    });
    expect(run?.status).toBe("waiting");
    // The cursor has not moved: the request is still owed.
    expect(run?.cursor).toBe("act");
    expect(run?.lastError).toContain("stubbed failure");

    const [app] = await db
      .select()
      .from(integrationApps)
      .where(eq(integrationApps.id, appId));
    expect(app?.failureCount).toBe(1);
    expect(app?.lastCheckOk).toBe(false);
    // Not disabled after one — twenty *consecutive* is spec 16's threshold.
    expect(app?.disabledAt).toBeNull();

    // A success resets the counter, so an endpoint that works most of the time
    // is never disabled.
    endpoint.ok = true;
    await db
      .update(automationRuns)
      .set({ wakeAt: new Date(Date.now() - 1_000) })
      .where(eq(automationRuns.id, run!.id));
    await runAutomationTick();

    const [after] = await db
      .select()
      .from(integrationApps)
      .where(eq(integrationApps.id, appId));
    expect(after?.failureCount).toBe(0);
  });

  it("refuses an app that was disabled", async () => {
    const appId = await makeApp({ disabledAt: new Date(), failureCount: 20 });
    const scenarioId = await makeScenario({
      trigger: "order.paid",
      action: "http.request",
      appId,
    });
    const email = `${PREFIX}disabled@example.com`;
    await makeContact(email);
    await enrolIfMatching({
      shopId,
      trigger: "order.paid",
      subject: { email },
      kinds: ["scenario"],
    });

    await runAutomationTick();
    expect(posts).toHaveLength(0);

    const run = await db.query.automationRuns.findFirst({
      where: eq(automationRuns.automationId, scenarioId),
    });
    expect((await timelineFor(run!.id))[0]?.detail).toContain("disabled");
  });
});

describe("the SSRF guard", () => {
  it("refuses a URL that is not one we will post to", async () => {
    /*
     * Re-validated at the send as well as at the write, because a hostname
     * that was public when the seller saved it can resolve somewhere else
     * tomorrow — and "Check connection" is precisely the button that turns a
     * naive implementation into a port scanner with our IP on it.
     */
    for (const baseUrl of [
      "http://hooks.example.com/inbound",
      "https://hooks.example.com:8443/inbound",
      "https://user:pass@hooks.example.com/inbound",
      "https://127.0.0.1/inbound",
      "https://localhost/inbound",
    ]) {
      const appId = await makeApp({ baseUrl });
      const scenarioId = await makeScenario({
        trigger: "order.paid",
        action: "http.request",
        appId,
      });
      const email = `${PREFIX}ssrf-${uid().slice(0, 6)}@example.com`;
      await makeContact(email);
      await enrolIfMatching({
        shopId,
        trigger: "order.paid",
        subject: { email },
        kinds: ["scenario"],
      });

      await runAutomationTick();

      const run = await db.query.automationRuns.findFirst({
        where: eq(automationRuns.automationId, scenarioId),
      });
      const timeline = await timelineFor(run!.id);
      expect(timeline[0]?.outcome, baseUrl).toBe("failed");
      expect(posts, baseUrl).toHaveLength(0);
    }
  });
});

describe("ownership", () => {
  it("will not post through another shop's app", async () => {
    // An app id lives in a stored graph, and a matcher that trusted it would
    // let one shop's scenario spend another shop's credential.
    const theirShop = await makeShop();
    const [theirApp] = await db
      .insert(integrationApps)
      .values({
        shopId: theirShop,
        label: "Theirs",
        baseUrl: "https://hooks.example.com/theirs",
        secretCiphertext: sealSecret("sk_live_theirs99"),
        headerName: "X-Api-Key",
      })
      .returning({ id: integrationApps.id });

    shopId = await makeShop();
    const scenarioId = await makeScenario({
      trigger: "order.paid",
      action: "http.request",
      appId: theirApp!.id,
    });
    const email = `${PREFIX}crossshop@example.com`;
    await makeContact(email);
    await enrolIfMatching({
      shopId,
      trigger: "order.paid",
      subject: { email },
      kinds: ["scenario"],
    });

    await runAutomationTick();
    expect(posts).toHaveLength(0);

    const run = await db.query.automationRuns.findFirst({
      where: eq(automationRuns.automationId, scenarioId),
    });
    expect((await timelineFor(run!.id))[0]?.detail).toContain("not this shop's");
  });
});

describe("the plan gate", () => {
  it("is the existing integrations flag, not a new one", async () => {
    /*
     * One credential opens webhooks, the API, MCP and scenarios; revoking it
     * revokes everything, which is what a seller expects of a single switch.
     */
    shopId = await makeShop("pro");
    const appId = await makeApp();
    await makeScenario({ trigger: "order.paid", action: "http.request", appId });
    const email = `${PREFIX}plan@example.com`;
    await makeContact(email);
    await enrolIfMatching({
      shopId,
      trigger: "order.paid",
      subject: { email },
      kinds: ["scenario"],
    });

    await runAutomationTick();
    expect(posts).toHaveLength(0);
  });
});

describe("kinds do not cross-trigger", () => {
  it("does not enrol a scenario into an email flow's trigger vocabulary", async () => {
    // A flow listening for `subscription.expired` is a row whose own
    // vocabulary does not contain it, and `triggerMatches` refuses.
    const [flow] = await db
      .insert(automations)
      .values({
        shopId,
        name: "A flow",
        kind: "email",
        status: "active",
        trigger: { type: "subscription.expired" } as never,
        graph: { nodes: [{ id: "n", kind: "whatsapp", config: { template: "hi" } }], edges: [] } as never,
      })
      .returning({ id: automations.id });

    const email = `${PREFIX}cross@example.com`;
    await makeContact(email);
    const results = await enrolIfMatching({
      shopId,
      trigger: "subscription.expired",
      subject: { email },
    });

    expect(results).toEqual([]);
    const runs = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.automationId, flow!.id));
    expect(runs).toEqual([]);
  });
});
