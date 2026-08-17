import type * as nextServer from "next/server";
import type * as post from "@sailo/webhooks/post";
import { assertLocalDatabase } from "./local-only";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

/**
 * Outbound webhooks, end to end, against a real database.
 *
 * Everything worth getting wrong here is invisible to a unit test, because it
 * is about *rows*: whether an event is queued after the order commits or
 * before it, whether two concurrent drains can claim the same delivery,
 * whether a failure advances the retry ladder or silently drops the event, and
 * whether a shop that downgraded keeps emitting.
 *
 * `postWebhook` is stubbed at the module boundary — the one seam that lets a
 * test observe a delivery at all, since the real one opens a socket to an
 * address the fixture invented. Every other layer is the production code:
 * the emit sites, the claim, the backoff arithmetic and the auto-disable all
 * run for real against real rows.
 */

/** Every POST the queue attempted, in order. */
const posted: { url: string; body: string; headers: Record<string, string> }[] = [];

/** What the stub should answer next. Set per test. */
let answer: post.PostResult = { ok: true, status: 200 };

vi.mock("@sailo/webhooks/post", async (importOriginal) => {
  const actual = await importOriginal<typeof post>();
  return {
    ...actual,
    postWebhook: async (opts: {
      url: string;
      body: string;
      headers: Record<string, string>;
    }) => {
      posted.push(opts);
      return answer;
    },
  };
});

/**
 * `after()` promises, held so a test can wait for them.
 *
 * `setup.ts` runs them inline but discards the promise, and an emit is three
 * database round trips behind the response — asserting straight after the
 * action raced it and reported "nothing queued" for a row still being written.
 */
const deferred: Promise<unknown>[] = [];

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof nextServer>()),
  after: (fn: (() => unknown) | Promise<unknown>) => {
    deferred.push(Promise.resolve(typeof fn === "function" ? fn() : fn));
  },
}));

async function flushAfter() {
  while (deferred.length > 0) {
    await Promise.allSettled(deferred.splice(0, deferred.length));
  }
}

const { getDb } = await import("@sailo/db");
const {
  orders,
  paymentMethods,
  products,
  shops,
  user,
  webhookDeliveries,
  webhookEndpoints,
} = await import("@sailo/db/schema");
const { createOrderIntent } = await import("@/lib/actions/orders");
const { runWebhookQueue, pruneWebhookDeliveries } = await import("@sailo/workflows/webhooks");
const { verifyWebhook, newWebhookSecret } = await import("@sailo/webhooks/signature");
const { isWebhookTargetUrl } = await import("@sailo/webhooks/post");

const db = getDb();
const uid = () => crypto.randomUUID();

beforeAll(() => {
  assertLocalDatabase();
});

beforeEach(async () => {
  posted.length = 0;
  deferred.length = 0;
  answer = { ok: true, status: 200 };

  /*
   * The queue is one table for the whole database, and `runWebhookQueue`
   * drains all of it — so a test that leaves rows pending is a test that
   * shows up inside the next one's POST count. Retiring what is left makes
   * each case start from an empty queue rather than from whatever ran before
   * it, which is the difference between this suite being order-dependent and
   * being deterministic.
   */
  await db
    .update(webhookDeliveries)
    .set({ status: "failed", error: "retired between scenario cases" })
    .where(eq(webhookDeliveries.status, "pending"));
});

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

async function makeShop(plan: "free" | "business" = "business") {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `hook-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `hook-${userId.slice(0, 8)}`,
      name: "Hooked Shop",
      currency: "USD",
      isPublished: true,
      plan,
      // `planFor` reads the status as well; without it a `business` row is
      // still resolved as free and every emit is silently gated off.
      subscriptionStatus: plan === "free" ? null : "active",
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");

  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type: "cod",
    label: "cod",
    config: {} as never,
    isEnabled: true,
    position: 0,
  });

  return shop;
}

async function makeEndpoint(
  shopId: string,
  over: Partial<typeof webhookEndpoints.$inferInsert> = {},
) {
  const [endpoint] = await db
    .insert(webhookEndpoints)
    .values({
      shopId,
      url: `https://hooks.example.com/${uid().slice(0, 8)}`,
      secret: newWebhookSecret(),
      events: ["order.created"],
      ...over,
    })
    .returning();
  if (!endpoint) throw new Error("fixture: endpoint was not inserted");
  return endpoint;
}

async function makeProduct(shopId: string) {
  const [product] = await db
    .insert(products)
    .values({
      shopId,
      title: "Speckled Mug",
      slug: `mug-${uid().slice(0, 8)}`,
      priceCents: 2400,
      kind: "physical",
      isPublished: true,
      trackInventory: false,
    })
    .returning();
  if (!product) throw new Error("fixture: product was not inserted");
  return product;
}

async function placeOrder(shopId: string, productId: string) {
  const result = await createOrderIntent({
    shopId,
    items: [{ productId, quantity: 1 }],
    paymentMethod: "cod",
    customerName: "Buyer",
    customerEmail: `buyer-${uid().slice(0, 8)}@example.com`,
    customerPhone: "+15550100",
    // A physical order will not be accepted without somewhere to send it, and
    // the address is on the payload this suite asserts against anyway.
    addressLine1: "1 Test Street",
    city: "Testville",
  });
  await flushAfter();
  return result;
}

const deliveriesFor = (shopId: string) =>
  db.select().from(webhookDeliveries).where(eq(webhookDeliveries.shopId, shopId));

/* -------------------------------------------------------------------------- */

describe("an order queues a delivery", () => {
  it("writes one pending row per subscribed endpoint, carrying the order", async () => {
    const shop = await makeShop();
    await makeEndpoint(shop.id);
    const product = await makeProduct(shop.id);

    const result = await placeOrder(shop.id, product.id);
    expect(result.ok).toBe(true);

    const rows = await deliveriesFor(shop.id);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row?.event).toBe("order.created");
    expect(row?.status).toBe("pending");
    expect(row?.attempt).toBe(0);

    /*
     * The payload is a snapshot taken at the moment of the event, not a
     * reference to be re-read later — so the order it describes has to be
     * fully there in the row.
     */
    const payload = row?.payload as {
      id: string;
      type: string;
      test: boolean;
      data: { id: string; total: { cents: number; amount: string } };
    };
    expect(payload.id).toBe(row?.id);
    expect(payload.type).toBe("order.created");
    expect(payload.test).toBe(false);
    expect(payload.data.total.cents).toBe(2400);
    expect(payload.data.total.amount).toBe("24.00");
  });

  it("queues nothing for an endpoint that did not ask for the event", async () => {
    const shop = await makeShop();
    await makeEndpoint(shop.id, { events: ["order.refunded"] });
    const product = await makeProduct(shop.id);

    await placeOrder(shop.id, product.id);
    expect(await deliveriesFor(shop.id)).toHaveLength(0);
  });

  it("queues nothing for an endpoint that is switched off", async () => {
    const shop = await makeShop();
    await makeEndpoint(shop.id, { isActive: false });
    const product = await makeProduct(shop.id);

    await placeOrder(shop.id, product.id);
    expect(await deliveriesFor(shop.id)).toHaveLength(0);
  });

  it("queues nothing for a shop whose plan does not include integrations", async () => {
    /*
     * The gate is checked at emit, not only in the settings UI — a seller who
     * downgrades keeps their endpoint rows, and this is what stops them
     * continuing to receive events they no longer pay for.
     */
    const shop = await makeShop("free");
    await makeEndpoint(shop.id);
    const product = await makeProduct(shop.id);

    await placeOrder(shop.id, product.id);
    expect(await deliveriesFor(shop.id)).toHaveLength(0);
  });

  it("fans out to every subscribed endpoint", async () => {
    const shop = await makeShop();
    await makeEndpoint(shop.id);
    await makeEndpoint(shop.id);
    const product = await makeProduct(shop.id);

    await placeOrder(shop.id, product.id);
    expect(await deliveriesFor(shop.id)).toHaveLength(2);
  });
});

describe("draining the queue", () => {
  it("posts the stored body, signed so a consumer can verify it", async () => {
    const shop = await makeShop();
    const endpoint = await makeEndpoint(shop.id);
    const product = await makeProduct(shop.id);
    await placeOrder(shop.id, product.id);

    await runWebhookQueue();

    expect(posted).toHaveLength(1);
    const attempt = posted[0];
    expect(attempt?.url).toBe(endpoint.url);

    /*
     * Verified with the documented recipe rather than by comparing to a
     * signature this suite computed itself. That is the only version of this
     * assertion that says anything about whether a seller's own library will
     * accept our messages.
     */
    const verdict = verifyWebhook({
      body: attempt?.body ?? "",
      headers: attempt?.headers ?? {},
      secret: endpoint.secret,
      now: new Date(),
    });
    expect(verdict).toEqual({ ok: true });

    // The header id and the body id are the same string — a consumer told to
    // dedupe on either one has to get the same answer.
    const body = JSON.parse(attempt?.body ?? "{}") as { id: string };
    expect(attempt?.headers["webhook-id"]).toBe(body.id);
    expect(attempt?.headers["sailo-event"]).toBe("order.created");

    const rows = await deliveriesFor(shop.id);
    expect(rows[0]?.status).toBe("ok");
    expect(rows[0]?.responseStatus).toBe(200);
    expect(rows[0]?.deliveredAt).not.toBeNull();
  });

  it("clears the endpoint's failure count on any success", async () => {
    const shop = await makeShop();
    const endpoint = await makeEndpoint(shop.id, { failureCount: 7 });
    const product = await makeProduct(shop.id);
    await placeOrder(shop.id, product.id);

    await runWebhookQueue();

    const [after] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, endpoint.id));
    expect(after?.failureCount).toBe(0);
    expect(after?.lastStatus).toBe("ok");
  });

  it("delivers each event once, however many ticks run", async () => {
    const shop = await makeShop();
    await makeEndpoint(shop.id);
    const product = await makeProduct(shop.id);
    await placeOrder(shop.id, product.id);

    await runWebhookQueue();
    await runWebhookQueue();
    await runWebhookQueue();

    expect(posted).toHaveLength(1);
  });

  it("lets two overlapping ticks claim disjoint work", async () => {
    /*
     * The claim is a conditional UPDATE that leases the row forward, and this
     * is the assertion that it actually excludes: two drains started together
     * must post once between them, not once each.
     */
    const shop = await makeShop();
    await makeEndpoint(shop.id);
    const product = await makeProduct(shop.id);
    await placeOrder(shop.id, product.id);

    await Promise.all([runWebhookQueue(), runWebhookQueue()]);

    expect(posted).toHaveLength(1);
  });
});

describe("when the endpoint fails", () => {
  it("advances the retry ladder rather than dropping the event", async () => {
    const shop = await makeShop();
    await makeEndpoint(shop.id);
    const product = await makeProduct(shop.id);
    await placeOrder(shop.id, product.id);

    answer = { ok: false, status: 500, reason: "the endpoint answered 500" };
    const before = Date.now();
    await runWebhookQueue();

    const [row] = await deliveriesFor(shop.id);
    expect(row?.status).toBe("pending");
    expect(row?.attempt).toBe(1);
    expect(row?.responseStatus).toBe(500);
    expect(row?.error).toBe("the endpoint answered 500");
    // First rung is a minute out, so the row is not due again this tick.
    expect(row?.nextAttemptAt.getTime()).toBeGreaterThan(before + 30_000);

    // And a tick right now finds nothing due.
    await runWebhookQueue();
    expect(posted).toHaveLength(1);
  });

  it("gives up after the ladder runs out, and says why", async () => {
    const shop = await makeShop();
    const endpoint = await makeEndpoint(shop.id);
    const product = await makeProduct(shop.id);
    await placeOrder(shop.id, product.id);

    answer = { ok: false, status: 502, reason: "the endpoint answered 502" };

    /*
     * Six attempts, forced by making each one due again immediately. Real time
     * would be fifteen hours; the ladder is what is under test, not the clock.
     */
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await db
        .update(webhookDeliveries)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) })
        .where(
          and(
            eq(webhookDeliveries.shopId, shop.id),
            eq(webhookDeliveries.status, "pending"),
          ),
        );
      await runWebhookQueue();
    }

    const [row] = await deliveriesFor(shop.id);
    expect(row?.attempt).toBe(6);
    expect(row?.status).toBe("failed");

    // A seventh tick must not resurrect it.
    await runWebhookQueue();
    expect(posted).toHaveLength(6);

    const [after] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, endpoint.id));
    expect(after?.failureCount).toBe(6);
    expect(after?.lastStatus).toBe("failed");
  });

  it("switches the endpoint off after twenty consecutive failures", async () => {
    const shop = await makeShop();
    // Nineteen already on the clock, so this tick's failure is the twentieth.
    const endpoint = await makeEndpoint(shop.id, { failureCount: 19 });
    const product = await makeProduct(shop.id);
    await placeOrder(shop.id, product.id);

    answer = { ok: false, status: 500, reason: "the endpoint answered 500" };
    await runWebhookQueue();

    const [after] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, endpoint.id));
    expect(after?.isActive).toBe(false);
    // The reason a seller reads on the card is the last real error, verbatim.
    expect(after?.disabledReason).toBe("the endpoint answered 500");
  });

  it("retires a queued delivery whose endpoint was switched off", async () => {
    const shop = await makeShop();
    const endpoint = await makeEndpoint(shop.id);
    const product = await makeProduct(shop.id);
    await placeOrder(shop.id, product.id);

    await db
      .update(webhookEndpoints)
      .set({ isActive: false })
      .where(eq(webhookEndpoints.id, endpoint.id));

    await runWebhookQueue();

    // Not left pending for ever, re-examined by every tick until it is pruned.
    expect(posted).toHaveLength(0);
    const [row] = await deliveriesFor(shop.id);
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("switched off");
  });

  it("gives up on an unusable signing secret instead of retrying it", async () => {
    const shop = await makeShop();
    await makeEndpoint(shop.id, { secret: "whsec_!!!" });
    const product = await makeProduct(shop.id);
    await placeOrder(shop.id, product.id);

    await runWebhookQueue();

    expect(posted).toHaveLength(0);
    const [row] = await deliveriesFor(shop.id);
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("rotate");
  });
});

describe("the address guard", () => {
  it("refuses a private address at save time", () => {
    // Restated here as well as in the unit test, because this is the predicate
    // the *action* calls before writing a row — a change that loosened it
    // would let an endpoint into the database that delivery then refuses on
    // every attempt for ever.
    expect(isWebhookTargetUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isWebhookTargetUrl("https://10.0.0.5/hook")).toBe(false);
    expect(isWebhookTargetUrl("http://hooks.example.com/hook")).toBe(false);
    expect(isWebhookTargetUrl("https://hooks.example.com/hook")).toBe(true);
  });
});

describe("pruning", () => {
  it("drops rows older than thirty days and keeps the rest", async () => {
    const shop = await makeShop();
    await makeEndpoint(shop.id);
    const product = await makeProduct(shop.id);
    await placeOrder(shop.id, product.id);

    const [row] = await deliveriesFor(shop.id);
    expect(row).toBeDefined();

    await pruneWebhookDeliveries();
    expect(await deliveriesFor(shop.id)).toHaveLength(1);

    await db
      .update(webhookDeliveries)
      .set({ createdAt: new Date(Date.now() - 31 * 24 * 3_600_000) })
      .where(eq(webhookDeliveries.id, row?.id ?? ""));

    await pruneWebhookDeliveries();
    expect(await deliveriesFor(shop.id)).toHaveLength(0);
  });
});

describe("the seller's own order events", () => {
  it("emits order.paid when the seller confirms the money, once", async () => {
    const shop = await makeShop();
    await makeEndpoint(shop.id, { events: ["order.paid"] });
    const product = await makeProduct(shop.id);
    const result = await placeOrder(shop.id, product.id);
    expect(result.ok).toBe(true);

    // Nothing yet: a manual order is written unpaid, and `order.created` is
    // not on this endpoint's list.
    expect(await deliveriesFor(shop.id)).toHaveLength(0);

    const [order] = await db.select().from(orders).where(eq(orders.shopId, shop.id));
    expect(order).toBeDefined();

    await db
      .update(orders)
      .set({ paymentStatus: "paid" })
      .where(eq(orders.id, order?.id ?? ""));

    /*
     * `updatePaymentStatus` runs behind `requireShop`, which these suites have
     * no session for — so the emit is exercised directly, on the same guard
     * the action applies: a transition into `paid`, not a re-save of it.
     */
    const { emitOrderWebhook } = await import("@sailo/webhooks/emit");
    await emitOrderWebhook({ shop, event: "order.paid", orderId: order?.id ?? "" });

    const rows = await deliveriesFor(shop.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event).toBe("order.paid");

    const payload = rows[0]?.payload as { data: { paymentStatus: string } };
    expect(payload.data.paymentStatus).toBe("paid");
  });
});
