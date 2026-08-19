import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  accountEvents,
  disputes,
  orders,
  platformUsageDaily,
  policySnapshots,
  shops,
  user,
} from "@sailo/db/schema";

/**
 * Spec 46 — Sailo answering a chargeback against its own subscription revenue.
 *
 * The pure rules are pinned in `packages/core`; this is the half that needs a
 * database, and it exists for four properties:
 *
 *   1. **Evidence assembles with no order present.** Every field resolver in
 *      `assemble.ts` reads an order, a shipment, a download log or a duplicate
 *      candidate. A subscription dispute has none of those, and the platform
 *      variant has to produce a real submission from `account_events`,
 *      `platform_usage_daily` and Sailo's own policy snapshot instead.
 *
 *   2. **A platform dispute never enters a shop's connected dispute rate.**
 *      `disputes_shop_scope_idx` exists for this and `stats.ts` scopes it — and
 *      the test below would fail if the filter were dropped, because this is the
 *      shape of bug that suspends a seller for arithmetic.
 *
 *   3. **The staff notification is claimed.** One dispute arrives under five
 *      event ids; the desk gets paged once.
 *
 *   4. **A second chargeback closes the card rail**, and an inquiry does not.
 */

const {
  claimStaffNotice,
  enforceCardBillingBlock,
  holdPlanForDispute,
  platformDecision,
  platformHoldingsFor,
  reinstatePlanAfterWin,
  rollUpPlatformUsage,
  shopDisputeStats,
} = await import("@sailo/commerce/disputes");
const { assemblePlatformEvidence } = await import("@sailo/core/disputes");

const db = getDb();
const uid = () => crypto.randomUUID();
const PREFIX = "platdis-";

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures([PREFIX]);
});

async function payingShop(over: Partial<typeof shops.$inferInsert> = {}) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Ada Lovelace",
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
      name: "Ada's Ceramics",
      currency: "USD",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
      subscriptionInterval: "month",
      stripeCustomerId: `cus_${uid().slice(0, 12)}`,
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

async function platformDispute(
  shopId: string | null,
  over: Partial<typeof disputes.$inferInsert> = {},
) {
  const [row] = await db
    .insert(disputes)
    .values({
      shopId,
      orderId: null,
      scope: "platform",
      stripeDisputeId: `dp_${uid().replace(/-/g, "").slice(0, 20)}`,
      amountCents: 4900,
      feeCents: 1500,
      deductedCents: 6400,
      currency: "usd",
      reason: "subscription_canceled",
      status: "needs_response",
      caseType: "chargeback",
      stripeCreatedAt: new Date(),
      fundsWithdrawnAt: new Date(),
      dueBy: new Date(Date.now() + 3 * 86_400_000),
      ...over,
    })
    .returning();
  if (!row) throw new Error("fixture: dispute was not inserted");
  return row;
}

/* ------------------------------------------------------------------------- */

describe("assembling with no order", () => {
  it("builds a submission out of signup, terms and usage", async () => {
    const shop = await payingShop();

    await db.insert(accountEvents).values([
      {
        userId: shop.userId,
        shopId: shop.id,
        kind: "signup",
        ip: "203.0.113.7",
        userAgent: "Mozilla/5.0",
        country: "PT",
        at: new Date(Date.now() - 60 * 86_400_000),
      },
      {
        userId: shop.userId,
        shopId: shop.id,
        kind: "terms_accepted",
        at: new Date(Date.now() - 60 * 86_400_000 + 5_000),
      },
      {
        userId: shop.userId,
        shopId: shop.id,
        kind: "signin",
        ip: "203.0.113.7",
        country: "PT",
        at: new Date(Date.now() - 5 * 86_400_000),
      },
    ]);

    await db.insert(platformUsageDaily).values({
      shopId: shop.id,
      day: new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10),
      signins: 2,
      ordersProcessed: 14,
      productsActive: 9,
      storefrontViews: 310,
      adminActions: 6,
    });

    await db.insert(policySnapshots).values({
      shopId: null,
      kind: "terms",
      contentHash: `platform-${uid()}`,
      body: "Sailo's terms, as they stood on the day this seller signed up.",
      source: "platform",
    });

    const dispute = await platformDispute(shop.id);
    const holdings = await platformHoldingsFor(dispute);
    expect(holdings).toBeTruthy();

    const evidence = assemblePlatformEvidence(dispute.reason, holdings!);

    // The whole argument, in one payload, with no order anywhere.
    expect(evidence.payload.access_activity_log).toMatch(/signed in from 203\.0\.113\.7/);
    expect(evidence.payload.access_activity_log).toMatch(/14 order\(s\) processed/);
    expect(evidence.payload.cancellation_rebuttal).toMatch(/No cancellation was ever received/);
    expect(evidence.payload.cancellation_policy_disclosure).toContain(
      "Sailo's terms, as they stood",
    );
    expect(evidence.completenessBp).toBe(10_000);
  });

  it("returns nothing rather than throwing when the charge matched no shop", async () => {
    /*
     * A platform charge Sailo has no account for is still a dispute against
     * Sailo's own balance and is still recorded. The desk must render it.
     */
    const dispute = await platformDispute(null);
    expect(await platformHoldingsFor(dispute)).toBeNull();
  });

  it("says refund when they cancelled and we billed anyway", async () => {
    const shop = await payingShop();
    await db.insert(accountEvents).values({
      userId: shop.userId,
      shopId: shop.id,
      kind: "plan_change",
      detail: { cancelAtPeriodEnd: true },
      at: new Date(Date.now() - 20 * 86_400_000),
    });

    const dispute = await platformDispute(shop.id);
    const holdings = await platformHoldingsFor(dispute);
    const decision = platformDecision(holdings!);

    // No usage rows at all and a cancellation before the charge.
    expect(decision.verdict).toBe("refund");
  });
});

/* ------------------------------------------------------------------------- */

describe("the shop's own dispute rate", () => {
  it("never counts a platform chargeback against the seller", async () => {
    /*
     * THE ARITHMETIC THAT SUSPENDS SOMEBODY.
     *
     * `rate.ts` measures a shop against the card networks' thresholds and
     * `escalation.ts` acts on the result — a payout hold, then a suspension. A
     * seller charging back their own Sailo subscription has produced no
     * chargeback against their *buyers*, and counting it would take their
     * livelihood off the air for a bill they disputed with us.
     *
     * This test fails if `eq(disputes.scope, "connected")` is dropped from
     * `stats.ts`, which is exactly what it is for.
     */
    const shop = await payingShop();
    await platformDispute(shop.id);
    await platformDispute(shop.id, { reason: "fraudulent" });

    const stats = await shopDisputeStats(shop.id);
    /*
     * `allTally` is the wider of the two — every dispute in the window, mature
     * cohort or not — so a platform row that leaked would show up here first.
     * `openDisputeCents` is the money the escalation ladder acts on.
     */
    expect(stats.allTally.chargebacks).toBe(0);
    expect(stats.allTally.fraudChargebacks).toBe(0);
    expect(stats.tally.chargebacks).toBe(0);
    expect(stats.openDisputeCents).toBe(0);
    /*
     * And the one that would actually leak.
     *
     * The cohort query joins disputes to *orders*, and a platform dispute has no
     * order — so the cohort tally is protected by the join whether or not the
     * scope filter is there, and asserting only on it would be a test that
     * cannot fail. `unattributedChargebacks` is the query that counts disputes
     * with `orderId IS NULL`, which is every platform dispute there is, and it
     * feeds `emergingRisk` straight into the escalation ladder.
     */
    expect(stats.unattributedChargebacks).toBe(0);
  });
});

/* ------------------------------------------------------------------------- */

describe("telling the desk", () => {
  it("claims the notice once however many deliveries arrive", async () => {
    // One dispute, five Stripe events, five different event ids. One page.
    const shop = await payingShop();
    const dispute = await platformDispute(shop.id);

    expect(await claimStaffNotice(dispute.id, "opened")).toBe(true);
    expect(await claimStaffNotice(dispute.id, "opened")).toBe(false);

    // The deadline notice is its own claim and is unaffected.
    expect(await claimStaffNotice(dispute.id, "deadline")).toBe(true);

    const row = await db.query.disputes.findFirst({ where: eq(disputes.id, dispute.id) });
    expect(row?.staffNotifiedAt).toBeTruthy();
    expect(row?.staffDeadlineNotifiedAt).toBeTruthy();
    /*
     * And the *seller* columns are untouched. Reusing them would make one column
     * mean two things depending on scope, which is the shape of bug that
     * silently stops notifying somebody.
     */
    expect(row?.sellerOpenedNotifiedAt).toBeNull();
    expect(row?.sellerDeadlineNotifiedAt).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */

describe("the remedy", () => {
  it("remembers the plan while the case runs and puts it back on a win", async () => {
    const shop = await payingShop();
    await platformDispute(shop.id);

    await holdPlanForDispute(shop.id);
    let row = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(row?.planBeforeDispute).toBe("business");

    // A downgrade lands while the case is open.
    await db.update(shops).set({ plan: "free" }).where(eq(shops.id, shop.id));

    expect(await reinstatePlanAfterWin(shop.id)).toBe(true);
    row = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(row?.plan).toBe("business");
    expect(row?.planBeforeDispute).toBeNull();
  });

  it("does not overwrite the remembered plan on a second delivery", async () => {
    const shop = await payingShop();
    await holdPlanForDispute(shop.id);
    await db.update(shops).set({ plan: "free" }).where(eq(shops.id, shop.id));
    // A retried `charge.dispute.created` must not remember "free".
    await holdPlanForDispute(shop.id);

    const row = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(row?.planBeforeDispute).toBe("business");
  });

  it("reinstates nothing when nothing was held", async () => {
    const shop = await payingShop();
    expect(await reinstatePlanAfterWin(shop.id)).toBe(false);
  });
});

describe("repeat offenders", () => {
  it("closes the card rail on the second chargeback and not the first", async () => {
    const shop = await payingShop();

    await platformDispute(shop.id);
    expect(await enforceCardBillingBlock(shop.id)).toBe(false);

    await platformDispute(shop.id, { reason: "fraudulent" });
    expect(await enforceCardBillingBlock(shop.id)).toBe(true);

    const row = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(row?.cardBillingBlockedAt).toBeTruthy();
    expect(row?.cardBillingBlockedReason).toMatch(/2 platform chargebacks/);
    /*
     * And nothing else moved. The shop keeps trading, keeps its storefront and
     * keeps taking card payments from its own buyers — all that closed is the
     * rail it pays us on.
     */
    expect(row?.suspendedAt).toBeNull();
    expect(row?.isPublished).toBe(true);
  });

  it("does not count an enquiry", async () => {
    // No money has moved on one, and counting it would close a seller's billing
    // over a question their bank asked.
    const shop = await payingShop();
    await platformDispute(shop.id, { caseType: "inquiry", status: "warning_needs_response" });
    await platformDispute(shop.id, { caseType: "inquiry", status: "warning_needs_response" });

    expect(await enforceCardBillingBlock(shop.id)).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */

describe("the usage rollup", () => {
  it("writes one row per paid shop per day, idempotently", async () => {
    const shop = await payingShop();
    const day = new Date(Date.now() - 86_400_000);
    const key = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
    );

    await db.insert(accountEvents).values({
      userId: shop.userId,
      shopId: shop.id,
      kind: "signin",
      at: new Date(key.getTime() + 3_600_000),
    });
    await db.insert(orders).values({
      shopId: shop.id,
      productTitle: "Speckled Mug",
      productKind: "physical",
      quantity: 1,
      unitPriceCents: 4200,
      subtotalCents: 4200,
      totalCents: 4200,
      currency: "USD",
      customerName: "Buyer",
      customerEmail: `${PREFIX}buyer-${uid().slice(0, 8)}@example.com`,
      paymentMethod: "card",
      paymentStatus: "paid",
      status: "confirmed",
      createdAt: new Date(key.getTime() + 7_200_000),
    });

    await rollUpPlatformUsage(day);
    await rollUpPlatformUsage(day);

    const rows = await db
      .select()
      .from(platformUsageDaily)
      .where(
        and(
          eq(platformUsageDaily.shopId, shop.id),
          eq(platformUsageDaily.day, key.toISOString().slice(0, 10)),
        ),
      );

    // Re-running overwrites rather than doubling, so a failed run is fixed by
    // running again.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.signins).toBe(1);
    expect(rows[0]?.ordersProcessed).toBe(1);
    expect(rows[0]?.rolledUpAt).toBeTruthy();
  });

  it("leaves a free shop out of it", async () => {
    /*
     * There is no subscription charge to dispute on a free plan, so folding the
     * whole fleet nightly would write rows nobody will ever read — every night,
     * forever.
     */
    const free = await payingShop({ plan: "free", subscriptionStatus: null });
    const day = new Date(Date.now() - 86_400_000);
    await rollUpPlatformUsage(day);

    const rows = await db
      .select()
      .from(platformUsageDaily)
      .where(eq(platformUsageDaily.shopId, free.id));
    expect(rows).toEqual([]);
  });
});
