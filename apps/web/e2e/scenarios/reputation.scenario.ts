import { createHmac, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { broadcastDeliveries, emailSuppressions, shops, user } from "@sailo/db/schema";
import { handleResendWebhook } from "@sailo/api/webhooks";
import {
  budgetFor,
  evaluateShop,
  reputationFor,
  sweepReputation,
} from "@sailo/marketing/broadcasts/server";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";

/**
 * The spam threshold as a system, end to end against real rows.
 *
 * The unit tests prove the arithmetic (`reputation.test.ts`) and the paused
 * branch of the budget (`quota.test.ts`). This proves the *chain* a real
 * complaint rides: a signed Resend webhook arrives → the address is
 * suppressed → the delivery flips to failed → the shop's rate crosses the
 * line → the shop is paused → the budget refuses — and then the two halves
 * of resolution: staff clearance restarts the window (a late webhook for a
 * pre-clearance send must not undo it), and the hourly sweep catches a
 * verdict the webhook failed to reach.
 *
 * The webhook is called exactly as production calls it — a `Request` with a
 * real svix signature over the raw body — because signature verification is
 * part of the chain, and a test that skipped it would go green against a
 * handler nobody can actually reach.
 */

assertLocalDatabase();

const db = getDb();
const PREFIX = "rep-";
const SECRET = `whsec_${Buffer.from("reputation-scenario-key").toString("base64")}`;

beforeAll(async () => {
  await purgeFixtures([PREFIX]);
});

beforeEach(() => {
  vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
  return () => vi.unstubAllEnvs();
});

const uid = () => randomUUID();

async function makeShop(over: Partial<typeof shops.$inferInsert> = {}) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `${PREFIX}${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `${PREFIX}${userId.slice(0, 8)}`,
      name: "Mailing Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

/**
 * `count` deliveries handed to the provider, `at` a moment of choice.
 * The denominator of the rate — `sentAt` is what `reputationFor` counts.
 */
async function sentDeliveries(shopId: string, count: number, at = new Date()) {
  const rows = Array.from({ length: count }, (_, i) => ({
    shopId,
    email: `buyer-${uid().slice(0, 8)}-${i}@example.com`,
    status: "sent",
    providerId: `re_${uid().replace(/-/g, "")}`,
    sentAt: at,
  }));
  const inserted = await db
    .insert(broadcastDeliveries)
    .values(rows)
    .returning({ id: broadcastDeliveries.id, providerId: broadcastDeliveries.providerId });
  return inserted;
}

/** A Request signed the way Resend signs — the handler's own scheme. */
function signedComplaint(providerId: string): Request {
  const body = JSON.stringify({
    type: "email.complained",
    data: { email_id: providerId },
  });
  const id = `msg_${uid().replace(/-/g, "")}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
  const mac = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");

  return new Request("https://sailo.store/api/resend/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${mac}`,
    },
    body,
  });
}

describe("a complaint rides the whole chain", () => {
  it("suppresses, flips the delivery, pauses the shop and refuses the budget", async () => {
    const shop = await makeShop();
    // Enough volume for the rate to mean anything (MIN_VOLUME = 100), and one
    // complaint over 100 sends is 1% — ten times the 0.1% line.
    const deliveries = await sentDeliveries(shop.id, 100);
    const victim = deliveries[0];
    if (!victim?.providerId) throw new Error("fixture: no provider id");

    const response = await handleResendWebhook(signedComplaint(victim.providerId));
    expect(response.status).toBe(200);

    // The address is off the list, with the reason that matters most.
    const suppression = await db.query.emailSuppressions.findFirst({
      where: eq(emailSuppressions.shopId, shop.id),
    });
    expect(suppression?.reason).toBe("complained");

    // The delivery row tells the truth about how it landed.
    const flipped = await db.query.broadcastDeliveries.findFirst({
      where: eq(broadcastDeliveries.id, victim.id),
    });
    expect(flipped?.status).toBe("failed");
    expect(flipped?.error).toBe("complained");

    // The shop is paused, and the budget — the one seam every marketing send
    // passes through — refuses without counting anything.
    const paused = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(paused?.marketingPausedAt).not.toBeNull();
    expect(paused?.marketingPausedReason).toBe("complaint_rate");
    expect(await budgetFor(paused!)).toEqual({ available: 0, limitedBy: "paused" });
  });

  it("refuses an unsigned delivery outright", async () => {
    const body = JSON.stringify({ type: "email.complained", data: { email_id: "re_x" } });
    const response = await handleResendWebhook(
      new Request("https://sailo.store/api/resend/webhook", { method: "POST", body }),
    );
    expect(response.status).toBe(400);
  });
});

describe("two webhooks racing", () => {
  it("stamps the pause exactly once", async () => {
    const shop = await makeShop();
    await sentDeliveries(shop.id, 100);
    // Two complaints already recorded; both verdicts run concurrently.
    const two = await db.query.broadcastDeliveries.findMany({
      where: eq(broadcastDeliveries.shopId, shop.id),
      limit: 2,
    });
    for (const row of two) {
      await db
        .update(broadcastDeliveries)
        .set({ status: "failed", error: "complained" })
        .where(eq(broadcastDeliveries.id, row.id));
    }

    const [first, second] = await Promise.all([
      evaluateShop(shop.id),
      evaluateShop(shop.id),
    ]);

    // Postgres decides: exactly one caller wins the conditional UPDATE.
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const paused = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(paused?.marketingPausedAt).not.toBeNull();
  });
});

describe("staff clearance is an adjudication, not a wish", () => {
  it("a late webhook for a pre-clearance send cannot re-pause the shop", async () => {
    const shop = await makeShop();
    const deliveries = await sentDeliveries(shop.id, 100);

    // The bad batch lands and pauses the shop.
    const victim = deliveries[0];
    if (!victim?.providerId) throw new Error("fixture: no provider id");
    await handleResendWebhook(signedComplaint(victim.providerId));
    let row = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(row?.marketingPausedAt).not.toBeNull();

    // Staff clear it — the resume writes the watermark.
    await db
      .update(shops)
      .set({
        marketingPausedAt: null,
        marketingPausedReason: null,
        marketingClearedAt: new Date(),
      })
      .where(eq(shops.id, shop.id));

    // A second complaint arrives late, for a send that PRECEDES the
    // clearance. The window now starts at the watermark, so the old batch
    // is adjudicated and this cannot re-pause the shop.
    const straggler = deliveries[1];
    if (!straggler?.providerId) throw new Error("fixture: no provider id");
    const response = await handleResendWebhook(signedComplaint(straggler.providerId));
    expect(response.status).toBe(200);

    row = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(row?.marketingPausedAt).toBeNull();

    // The suppression still landed — clearance forgives the rate, never the
    // address. That buyer said no.
    const suppressions = await db.query.emailSuppressions.findMany({
      where: eq(emailSuppressions.shopId, shop.id),
    });
    expect(suppressions.length).toBeGreaterThanOrEqual(2);
  });

  it("a bad batch after clearance pauses again — new behaviour counts in full", async () => {
    const shop = await makeShop({ marketingClearedAt: new Date(Date.now() - 60_000) });

    // A fresh batch entirely after the watermark, one complaint over 100.
    const deliveries = await sentDeliveries(shop.id, 100);
    const victim = deliveries[0];
    if (!victim?.providerId) throw new Error("fixture: no provider id");
    await handleResendWebhook(signedComplaint(victim.providerId));

    const row = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(row?.marketingPausedAt).not.toBeNull();
  });
});

describe("the hourly sweep", () => {
  it("catches a shop whose verdict the webhook never reached", async () => {
    const shop = await makeShop();
    await sentDeliveries(shop.id, 100);
    // The suppression landed but the verdict crashed: the row says complained
    // and the shop is not paused — exactly the state the sweep exists for.
    const [victim] = await db.query.broadcastDeliveries.findMany({
      where: eq(broadcastDeliveries.shopId, shop.id),
      limit: 1,
    });
    await db
      .update(broadcastDeliveries)
      .set({ status: "failed", error: "complained" })
      .where(eq(broadcastDeliveries.id, victim!.id));

    const swept = await sweepReputation();
    const mine = swept.paused.find((p) => p.shopId === shop.id);
    expect(mine?.reason).toBe("complaint_rate");

    const row = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(row?.marketingPausedAt).not.toBeNull();
  });

  it("does not look at a shop that is already paused", async () => {
    const shop = await makeShop({ marketingPausedAt: new Date() });
    await sentDeliveries(shop.id, 100);
    const [victim] = await db.query.broadcastDeliveries.findMany({
      where: eq(broadcastDeliveries.shopId, shop.id),
      limit: 1,
    });
    await db
      .update(broadcastDeliveries)
      .set({ status: "failed", error: "complained" })
      .where(eq(broadcastDeliveries.id, victim!.id));

    const swept = await sweepReputation();
    expect(swept.paused.find((p) => p.shopId === shop.id)).toBeUndefined();
  });
});

describe("what the rate is made of", () => {
  it("counts recovery-shaped rows — broadcastId null — like any other send", async () => {
    /*
     * Recovery, restock and testimonial mail write delivery rows with no
     * broadcast id, which is what lets their complaints reach this rate at
     * all. The rate must not care which kind of marketing mail it was.
     */
    const shop = await makeShop();
    await sentDeliveries(shop.id, 50);
    const reputation = await reputationFor(shop.id);
    expect(reputation.sent).toBe(50);
    expect(reputation.complaints).toBe(0);
  });
});
