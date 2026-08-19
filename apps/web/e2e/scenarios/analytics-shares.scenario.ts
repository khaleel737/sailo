import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  analyticsShares,
  automationRuns,
  automations,
  checkoutSessions,
  orders,
  shops,
  user,
} from "@sailo/db/schema";
import { SHARE_MAX_DAYS } from "@sailo/analytics/shares";
import {
  createShare,
  MAX_LIVE_SHARES,
  resolveShare,
  revokeShare,
  sharesFor,
} from "@sailo/analytics/shares/server";
import { expansionTiles, hasExpansionSources } from "@sailo/analytics/tiles";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";

/**
 * A public link to one number, and the four tiles behind it.
 *
 * The share half is the most dangerous thing in spec 42 — a public URL
 * rendering a shop's revenue — so what is asserted here is what an attacker
 * would try: editing the scope, replaying an expired token, replaying a
 * revoked one, and guessing.
 *
 * The tile half asserts the rule the whole spec is sequenced around: **no tile
 * whose source has not shipped**, and each figure matches a hand-computed one
 * over a seeded window.
 *
 * Run with:
 *   npx dotenv -e .env.local.test -- \
 *     npx vitest run --config vitest.scenarios.mts e2e/scenarios/analytics-shares.scenario.ts
 */

const db = getDb();
const uid = () => crypto.randomUUID();
const PREFIX = "sc-shares-";

let shopId: string;

async function makeShop(): Promise<string> {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Share Fixture",
    email: `${PREFIX}${userId}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      name: "Share Fixture",
      handle: `${PREFIX}${uid().slice(0, 8)}`,
      currency: "USD",
      plan: "business",
      subscriptionStatus: "active",
    })
    .returning({ id: shops.id });
  return shop!.id;
}

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures([PREFIX]);
});

beforeEach(async () => {
  shopId = await makeShop();
});

describe("a share link", () => {
  it("resolves to exactly one metric and one range", async () => {
    const made = await createShare({
      shopId,
      metric: "revenue",
      range: "30d",
      createdByEmail: `${PREFIX}owner@example.com`,
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;

    const resolved = await resolveShare(made.token);
    expect(resolved).toMatchObject({ shopId, metric: "revenue", range: "30d" });
  });

  it("cannot be edited into a different metric or a wider range", async () => {
    /*
     * The single most important property. The scope lives on the row and not
     * in the URL, so there is nothing in the address to change — this asserts
     * that by construction: whatever is appended to the token, the resolved
     * scope is the one that was minted.
     */
    const made = await createShare({ shopId, metric: "orders", range: "7d" });
    if (!made.ok) return;

    for (const suffix of ["?metric=revenue", "?range=365d", "&metric=revenue"]) {
      const resolved = await resolveShare(made.token + suffix);
      // The token itself no longer matches, so the link simply does not
      // resolve — there is no path where a parameter selects the figure.
      expect(resolved, suffix).toBeNull();
    }

    // And the untouched token still says what it always said.
    expect(await resolveShare(made.token)).toMatchObject({
      metric: "orders",
      range: "7d",
    });
  });

  it("stores a hash, never the token", async () => {
    // A dump of this table is not a set of working links.
    const made = await createShare({ shopId, metric: "revenue", range: "30d" });
    if (!made.ok) return;

    const [row] = await db
      .select()
      .from(analyticsShares)
      .where(eq(analyticsShares.shopId, shopId));
    expect(row?.tokenHash).not.toBe(made.token);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The prefix is a label, not a secret, and cannot be replayed.
    expect(await resolveShare(row!.tokenPrefix)).toBeNull();
  });

  it("refuses an expiry beyond the maximum rather than clamping it", async () => {
    expect(
      await createShare({ shopId, metric: "revenue", range: "30d", days: 365 }),
    ).toEqual({ ok: false, reason: "expiry" });
    expect(
      (await createShare({ shopId, metric: "revenue", range: "30d", days: SHARE_MAX_DAYS })).ok,
    ).toBe(true);
  });

  it("refuses a metric that is not in the vocabulary", async () => {
    expect(
      await createShare({ shopId, metric: "everything", range: "30d" }),
    ).toEqual({ ok: false, reason: "metric" });
  });

  it("stops resolving once it expires", async () => {
    const made = await createShare({ shopId, metric: "revenue", range: "30d", days: 1 });
    if (!made.ok) return;

    expect(await resolveShare(made.token)).not.toBeNull();
    // A day and a minute later.
    expect(
      await resolveShare(made.token, new Date(Date.now() + 86_400_000 + 60_000)),
    ).toBeNull();
  });

  it("stops resolving once it is revoked, and stays revoked", async () => {
    const made = await createShare({ shopId, metric: "revenue", range: "30d" });
    if (!made.ok) return;
    const [row] = await db
      .select()
      .from(analyticsShares)
      .where(eq(analyticsShares.shopId, shopId));

    expect(await revokeShare(shopId, row!.id)).toBe(true);
    expect(await resolveShare(made.token)).toBeNull();

    // Idempotent: a seller pressing it twice is one who is not sure it worked.
    expect(await revokeShare(shopId, row!.id)).toBe(false);

    const [listed] = await sharesFor(shopId);
    expect(listed?.state).toBe("revoked");
  });

  it("will not let one shop revoke another's link", async () => {
    const made = await createShare({ shopId, metric: "revenue", range: "30d" });
    if (!made.ok) return;
    const [row] = await db
      .select()
      .from(analyticsShares)
      .where(eq(analyticsShares.shopId, shopId));

    const otherShop = await makeShop();
    expect(await revokeShare(otherShop, row!.id)).toBe(false);
    // Still live for its owner.
    expect(await resolveShare(made.token)).not.toBeNull();
  });

  it("refuses a token nobody minted, without saying so differently", async () => {
    // "This link has expired" and "this link never existed" are different
    // facts about a shop, and nobody browsing needs either.
    expect(await resolveShare("not-a-real-token")).toBeNull();
    expect(await resolveShare("")).toBeNull();
    expect(await resolveShare("x".repeat(500))).toBeNull();
  });

  it("caps how many live links one shop may have", async () => {
    for (let i = 0; i < MAX_LIVE_SHARES; i += 1) {
      expect((await createShare({ shopId, metric: "revenue", range: "30d" })).ok).toBe(true);
    }
    expect(await createShare({ shopId, metric: "revenue", range: "30d" })).toEqual({
      ok: false,
      reason: "limit",
    });
  });

  it("never hands a token back from the list", async () => {
    // A link a seller can re-read from a settings page is a link that lives in
    // a browser cache and a screenshot.
    await createShare({ shopId, metric: "revenue", range: "30d" });
    const listed = await sharesFor(shopId);
    expect(Object.keys(listed[0]!)).not.toContain("token");
    expect(Object.keys(listed[0]!)).not.toContain("tokenHash");
  });
});

describe("the four tiles", () => {
  it("shows nothing at all before a source has shipped for this shop", async () => {
    /*
     * The other half of "no tile reads zero because its source does not
     * exist". A seller who has never switched recovery on cannot tell
     * "nobody came back" from "this does not work", and the second reading is
     * the one they act on.
     */
    expect(await hasExpansionSources(shopId)).toEqual({
      sessions: false,
      automations: false,
    });
  });

  it("matches a hand-computed figure over a seeded window", async () => {
    const since = new Date(Date.now() - 7 * 86_400_000);

    // Three sessions: one recovered for 2500, one finalized, one still open.
    const [order] = await db
      .insert(orders)
      .values({
        shopId,
        productTitle: "A mug",
        unitPriceCents: 2_500,
        subtotalCents: 2_500,
        totalCents: 2_000, // paid *after* a recovery discount
        currency: "USD",
        paymentMethod: "card",
        paymentStatus: "paid",
      })
      .returning({ id: orders.id });

    await db.insert(checkoutSessions).values([
      {
        shopId,
        visitorKey: uid(),
        status: "recovered",
        orderId: order!.id,
        subtotalCents: 2_500,
        openedAt: new Date(Date.now() - 86_400_000),
      },
      {
        shopId,
        visitorKey: uid(),
        status: "finalized",
        subtotalCents: 4_000,
        openedAt: new Date(Date.now() - 86_400_000),
      },
      {
        shopId,
        visitorKey: uid(),
        status: "opened",
        subtotalCents: 1_000,
        openedAt: new Date(Date.now() - 86_400_000),
      },
      // Outside the window — must not be counted.
      {
        shopId,
        visitorKey: uid(),
        status: "recovered",
        subtotalCents: 9_999,
        openedAt: new Date(Date.now() - 30 * 86_400_000),
      },
    ]);

    // Two flow runs, one done. Plus a scenario run, which must not count.
    const [flow] = await db
      .insert(automations)
      .values({ shopId, name: "Flow", kind: "email", status: "active" })
      .returning({ id: automations.id });
    const [scenario] = await db
      .insert(automations)
      .values({ shopId, name: "Scenario", kind: "scenario", status: "active" })
      .returning({ id: automations.id });

    await db.insert(automationRuns).values([
      { automationId: flow!.id, shopId, email: `${PREFIX}a@example.com`, status: "done" },
      { automationId: flow!.id, shopId, email: `${PREFIX}b@example.com`, status: "waiting" },
      {
        automationId: scenario!.id,
        shopId,
        email: `${PREFIX}c@example.com`,
        status: "done",
      },
    ]);

    const tiles = await expansionTiles(shopId, since);

    expect(tiles.checkoutSessions).toBe(3);
    expect(tiles.recoveredOrders).toBe(1);
    /*
     * 2000, not 2500. The order records what was actually paid and the session
     * records what the basket was worth when it was abandoned — a recovery
     * discount makes those different, and reporting the basket would overstate
     * every recovery by exactly the discount that caused it.
     */
    expect(tiles.recoveredCents).toBe(2_000);

    // Flows only. A seller's Zapier posts are not "automation runs" on a
    // marketing dashboard.
    expect(tiles.automationRuns).toBe(2);
    expect(tiles.automationCompleted).toBe(1);

    expect(await hasExpansionSources(shopId)).toEqual({
      sessions: true,
      automations: true,
    });
  });
});
