import { describe, expect, it, vi } from "vitest";
import type * as sessionModule from "@/lib/session";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  disputes,
  earlyFraudWarnings,
  orderItems,
  orders,
  shops,
  user,
} from "@sailo/db/schema";
import {
  DISPUTE_QUEUE_PAGE,
  getDisputeDetail,
  getDisputeOrders,
  getDisputeQueue,
  getOpenFraudWarnings,
  getPlatformDisputeHealth,
  getShopDisputes,
  getShopExposure,
} from "@/lib/platform/disputes";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";

/**
 * The six queries behind /hq/disputes, run against real rows.
 *
 * These lived in `apps/web/e2e/scenarios/disputes.scenario.ts` until HQ moved
 * out of apps/web and the import they were reached through — `@/lib/hq/disputes`
 * — stopped resolving. Because it was a top-level `await import`, the failure
 * was not confined to the six: the *entire* 1,583-line chargeback suite failed
 * to load, and had been reporting "no tests" rather than a failure ever since.
 * Repointing it was not an option — every function here opens with
 * `requireStaff()` from `@/lib/session`, and `@/` means `apps/web/src` in that
 * config. They belong in this app, so they are tested from it.
 *
 * What is under test is the *SQL*, which is the half no unit test and no
 * typecheck reaches. Four of these are the shape that typechecks and then throws
 * at runtime: a correlated subquery inside a `select`, an `in` over a JavaScript
 * array, a `group by` that has to name every non-aggregated column, and an
 * `order by … nulls last`. The pages' arithmetic is tested in `apps/web`; none
 * of this had ever executed.
 *
 * Fixtures are inserted directly rather than driven through
 * `charge.dispute.created`. That webhook's mapping onto these rows is what the
 * apps/web suite exists to prove, and depending on it here would make a query
 * test fail for a reason that has nothing to do with the query.
 *
 * Run with:
 *   npx dotenv -e ../../.env.local.test -- \
 *     npx vitest run --config vitest.scenarios.mts \
 *     e2e/scenarios/dispute-desk.scenario.ts
 */

/*
 * The staff guard, and only the staff guard.
 *
 * Every read here opens with `requireStaff()` deliberately — they scan every
 * account on the platform, and the /hq layout's own check is not proof the
 * page's reads never ran, because Next renders a layout and its page in
 * parallel. In a scenario there is no request and so no session. Only the guard
 * is replaced; the rest of the module stays real.
 */
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof sessionModule>()),
  requireStaff: async () => ({
    id: "scenario-staff",
    email: "staff@sailo.store",
    emailVerified: true,
  }),
}));

const db = getDb();
const uid = () => crypto.randomUUID();
const ACCOUNT = "acct_ddesk_seller";

/** The handle prefix every fixture here carries, and the one `purge` removes. */
const PREFIX = "ddesk-";

/*
 * Clear what earlier runs left behind.
 *
 * Against a throwaway container this is a no-op. Against the Neon dev branch
 * these suites actually run on it is what keeps `getShopExposure` — which is
 * capped at a hundred shops — from eventually ranking this fixture off the end
 * of its own result.
 */
assertLocalDatabase();
await purgeFixtures([PREFIX]);

async function sellerShop(over: Partial<typeof shops.$inferInsert> = {}) {
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
      name: "Disputed Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      stripeAccountId: ACCOUNT,
      stripeChargesEnabled: true,
      stripeCustomerId: `cus_${userId.slice(0, 12)}`,
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

/** A settled card order, in the state the webhook leaves one. */
async function paidOrder(
  shopId: string,
  over: Partial<typeof orders.$inferInsert> = {},
) {
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      productTitle: "Speckled Mug",
      productKind: "physical",
      quantity: 1,
      unitPriceCents: 4200,
      subtotalCents: 4200,
      totalCents: 4200,
      currency: "USD",
      customerName: "Ada Lovelace",
      customerEmail: `ada-${uid().slice(0, 8)}@example.com`,
      paymentMethod: "card",
      paymentStatus: "paid",
      status: "confirmed",
      stripePaymentIntentId: `pi_${uid().replace(/-/g, "")}`,
      stripeAccountId: ACCOUNT,
      ...over,
    })
    .returning();
  if (!order) throw new Error("fixture: order was not inserted");

  await db.insert(orderItems).values({
    orderId: order.id,
    title: "Speckled Mug",
    kind: "physical",
    unitPriceCents: 4200,
    quantity: 1,
    subtotalCents: 4200,
    position: 0,
  });
  return order;
}

/**
 * A chargeback, as `charge.dispute.created` records one.
 *
 * `deductedCents` is 5,700 rather than 4,200 for the same reason it is in
 * production: Stripe's $15 dispute fee leaves with the money, and it is what a
 * seller actually loses.
 */
async function chargeback(
  shopId: string,
  over: Partial<typeof disputes.$inferInsert> = {},
) {
  const [row] = await db
    .insert(disputes)
    .values({
      scope: "connected",
      shopId,
      stripeDisputeId: `du_${uid().replace(/-/g, "")}`,
      stripeChargeId: `ch_${uid().replace(/-/g, "")}`,
      stripeAccountId: ACCOUNT,
      amountCents: 4_200,
      feeCents: 1_500,
      deductedCents: 5_700,
      currency: "USD",
      reason: "product_not_received",
      caseType: "chargeback",
      status: "needs_response",
      /*
       * Inside the hour, deliberately.
       *
       * The queue fetches the two hundred soonest deadlines, and the branch this
       * runs against carries every dispute every earlier suite left behind. A
       * fixture with Stripe's usual three-week window would sort among them
       * rather than above them, and the assertion would start depending on how
       * many times the other suites had been run.
       */
      dueBy: new Date(Date.now() + 3_600_000),
      stripeCreatedAt: new Date(),
      fundsWithdrawnAt: new Date(),
      ...over,
    })
    .returning();
  if (!row) throw new Error("fixture: dispute was not inserted");
  return row;
}

/* ------------------------------------------------------------------------- */

describe("the response queue", () => {
  it("lists what still owes an answer, soonest deadline first", async () => {
    const shop = await sellerShop();
    const later = await paidOrder(shop.id);
    const soon = await paidOrder(shop.id);

    await chargeback(shop.id, {
      orderId: later.id,
      dueBy: new Date(Date.now() + 2 * 3_600_000),
    });
    await chargeback(shop.id, {
      orderId: soon.id,
      dueBy: new Date(Date.now() + 1 * 3_600_000),
    });

    const queue = await getDisputeQueue();
    const mine = queue.rows.filter((row) => row.shopId === shop.id);
    expect(mine).toHaveLength(2);

    // Soonest first, and every row carries what the table renders.
    expect(mine[0]!.dueBy!.getTime()).toBeLessThan(mine[1]!.dueBy!.getTime());
    expect(mine[0]!.orderId).toBe(soon.id);
    expect(mine[0]!.daysLeft).not.toBeNull();
    expect(mine[0]!.reasonLabel).toBeTruthy();
    expect(mine[0]!.guidance).toBeTruthy();
    expect(mine[0]!.shopHandle).toBe(shop.handle);
    expect(mine[0]!.deductedCents).toBe(5_700);
    expect(mine[0]!.inquiry).toBe(false);
    expect(mine[0]!.outcome).toBeTruthy();
  });

  it("sorts a dispute with no deadline below one that expires tomorrow", async () => {
    /*
     * `nulls last`, which is not what a plain ascending sort does in Postgres.
     * A dispute Stripe gave no `due_by` for is one nobody can miss a date on;
     * at the top of the queue it displaces the ones that can be lost by
     * inaction, which is the only thing this screen is sorted for.
     */
    const shop = await sellerShop();
    await chargeback(shop.id, { dueBy: null });
    await chargeback(shop.id, { dueBy: new Date(Date.now() + 3_600_000) });

    const queue = await getDisputeQueue();
    const mine = queue.rows.filter((row) => row.shopId === shop.id);
    expect(mine).toHaveLength(2);
    expect(mine[0]!.dueBy).not.toBeNull();
    expect(mine[1]!.dueBy).toBeNull();
    expect(mine[1]!.daysLeft).toBeNull();
  });

  it("leaves a dispute nobody can act on out of it, until `all` is asked for", async () => {
    const shop = await sellerShop();
    await chargeback(shop.id, { status: "under_review" });

    const open = await getDisputeQueue();
    expect(open.rows.filter((row) => row.shopId === shop.id)).toHaveLength(0);

    const all = await getDisputeQueue({ all: true, limit: 500 });
    expect(all.rows.filter((row) => row.shopId === shop.id)).toHaveLength(1);
  });

  it("says what it is not showing, rather than truncating quietly", async () => {
    /*
     * A cap that is not stated is the bug wearing a tidier layout. The page can
     * only say "the 25 most urgent of 148" if the query hands it both numbers.
     */
    const shop = await sellerShop();
    await chargeback(shop.id);
    await chargeback(shop.id);

    const capped = await getDisputeQueue({ limit: 1 });
    expect(capped.rows).toHaveLength(1);
    expect(capped.total).toBeGreaterThan(1);
    expect(capped.capped).toBe(true);

    const uncapped = await getDisputeQueue({ limit: 500 });
    expect(uncapped.capped).toBe(false);
    expect(uncapped.rows.length).toBe(uncapped.total);

    // The page's own default, so a change to it is a change somebody made.
    expect(DISPUTE_QUEUE_PAGE).toBe(25);
  });

  it("resolves the orders behind a queue, without dropping the ones that have none", async () => {
    /*
     * The `in` over an array, which is the one that throws if built wrongly —
     * and the join, which must not be what filters the queue: a dispute with no
     * order is exactly the row most worth looking at.
     */
    const shop = await sellerShop();
    const order = await paidOrder(shop.id);
    const withOrder = await chargeback(shop.id, { orderId: order.id });
    const without = await chargeback(shop.id, { orderId: null });

    const resolved = await getDisputeOrders([withOrder.id, without.id]);
    expect(resolved.get(withOrder.id)?.id).toBe(order.id);
    expect(resolved.get(withOrder.id)?.title).toBe("Speckled Mug");
    expect(resolved.has(without.id)).toBe(false);

    // Both are still in the queue; only one of them has an order to link to.
    const queue = await getDisputeQueue({ limit: 500 });
    expect(queue.rows.filter((row) => row.shopId === shop.id)).toHaveLength(2);

    // And an empty list must not produce `in ()`, which is a syntax error.
    expect((await getDisputeOrders([])).size).toBe(0);
  });
});

/* ------------------------------------------------------------------------- */

describe("the exposure screen", () => {
  it("ranks shops by exposure, with the floor applied to the screening rate", async () => {
    const shop = await sellerShop();
    for (let i = 0; i < 60; i++) await paidOrder(shop.id);
    for (let i = 0; i < 4; i++) await chargeback(shop.id);

    const rows = await getShopExposure();
    const mine = rows.find((row) => row.shopId === shop.id);
    expect(mine).toBeDefined();
    expect(mine!.chargebacks).toBe(4);
    expect(mine!.settledOrders).toBeGreaterThanOrEqual(60);
    expect(mine!.chargebackBp).not.toBeNull();
    expect(mine!.openDisputeCents).toBe(4 * 5_700);
    expect(mine!.awaitingResponse).toBe(4);
    expect(mine!.ownerEmail).toContain("@");
    expect(mine!.handle).toBe(shop.handle);
  });

  it("withholds the screening rate below the floor, like every other rate here", async () => {
    const shop = await sellerShop();
    for (let i = 0; i < 5; i++) await paidOrder(shop.id);
    await chargeback(shop.id);

    const mine = (await getShopExposure()).find((row) => row.shopId === shop.id);
    // One dispute on five orders is 2,000bp and means nothing.
    expect(mine!.chargebacks).toBe(1);
    expect(mine!.chargebackBp).toBeNull();
  });

  it("counts an inquiry apart from a chargeback", async () => {
    /*
     * `warning_needs_response` is Stripe's inquiry status, and an inquiry has
     * taken no money and counts towards no network programme. Adding it to the
     * chargeback column would put shops on a risk screen for having answered a
     * question.
     */
    const shop = await sellerShop();
    for (let i = 0; i < 30; i++) await paidOrder(shop.id);
    await chargeback(shop.id, {
      status: "warning_needs_response",
      caseType: "inquiry",
      deductedCents: 0,
      feeCents: 0,
      fundsWithdrawnAt: null,
    });
    await chargeback(shop.id);
    await chargeback(shop.id);

    const mine = (await getShopExposure()).find((row) => row.shopId === shop.id);
    expect(mine!.chargebacks).toBe(2);
    expect(mine!.inquiries).toBe(1);
    // Both chargebacks and the inquiry are all still awaiting a response.
    expect(mine!.awaitingResponse).toBe(3);
    // The inquiry took nothing, so it adds nothing to what is at stake.
    expect(mine!.openDisputeCents).toBe(2 * 5_700);
  });

  it("keeps a seller's own subscription chargeback out of the connected rate", async () => {
    /*
     * A platform dispute is an argument between the seller and Sailo. Counting
     * it here would put a shop on the risk screen for disputing an invoice.
     */
    const shop = await sellerShop();
    for (let i = 0; i < 30; i++) await paidOrder(shop.id);
    await chargeback(shop.id, {
      scope: "platform",
      stripeAccountId: null,
      reason: "subscription_canceled",
    });

    const mine = (await getShopExposure()).find((row) => row.shopId === shop.id);
    expect(mine).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------- */

describe("the platform's own numbers", () => {
  it("reports the arrival-month ratio, and what it is measured against", async () => {
    const shop = await sellerShop();
    await paidOrder(shop.id);
    await chargeback(shop.id);

    const health = await getPlatformDisputeHealth();

    expect(Array.isArray(health.months)).toBe(true);
    expect(health.thresholds.length).toBeGreaterThan(0);
    expect(health.sailoThresholds.reviewBp).toBeLessThan(
      Math.min(...health.thresholds.map((t) => t.thresholdBp)),
    );
    // The coverage forecast, which is the number that says whether the next four
    // months can be defended at all.
    expect(health.coverage.orders).toBeGreaterThanOrEqual(0);
    expect(health.coverage.ce3Capable).toBeLessThanOrEqual(health.coverage.orders);
    expect(health.open).toBeGreaterThan(0);
    expect(health.awaiting).toBeGreaterThan(0);
    expect(health.total).toBeGreaterThanOrEqual(health.open);
    // Won and lost are the only two a win rate can be taken over.
    expect(health.winRateBp === null || health.winRateBp >= 0).toBe(true);
  });

  it("lists open fraud warnings, and only the ones still worth acting on", async () => {
    /*
     * The point of the list is that a refund is still possible. A warning that
     * already became a dispute, and one already refunded, are both finished —
     * on the screen they are two more rows nobody can do anything about.
     */
    const shop = await sellerShop();
    const order = await paidOrder(shop.id);
    const dispute = await chargeback(shop.id, { orderId: order.id });

    const open = `efw_${uid().replace(/-/g, "")}`;
    await db.insert(earlyFraudWarnings).values([
      {
        shopId: shop.id,
        orderId: order.id,
        stripeWarningId: open,
        stripeChargeId: `ch_${uid().replace(/-/g, "")}`,
        stripeAccountId: ACCOUNT,
        fraudType: "made_with_stolen_card",
        actionable: "true",
        stripeCreatedAt: new Date(),
      },
      {
        shopId: shop.id,
        stripeWarningId: `efw_${uid().replace(/-/g, "")}`,
        stripeAccountId: ACCOUNT,
        fraudType: "misc",
        disputeId: dispute.id,
        stripeCreatedAt: new Date(),
      },
      {
        shopId: shop.id,
        stripeWarningId: `efw_${uid().replace(/-/g, "")}`,
        stripeAccountId: ACCOUNT,
        fraudType: "unauthorized_use_of_card",
        refundedAt: new Date(),
        stripeCreatedAt: new Date(),
      },
    ]);

    const rows = await getOpenFraudWarnings();
    const mine = rows.filter((row) => row.warning.shopId === shop.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.warning.stripeWarningId).toBe(open);
    expect(mine[0]!.shopHandle).toBe(shop.handle);
  });
});

/* ------------------------------------------------------------------------- */

describe("one dispute, and one shop's", () => {
  it("assembles the detail page's read, and survives Stripe being unreachable", async () => {
    /*
     * `disputeReadiness` reaches Stripe and is allowed to fail — a dispute whose
     * account is unreachable still has a deadline, an amount and a shop, and a
     * page that 500s because Stripe is slow is a page that is down at exactly
     * the moment somebody needed the deadline. There is no Stripe account behind
     * this fixture, so that catch is what this exercises.
     */
    const shop = await sellerShop();
    const order = await paidOrder(shop.id);
    const dispute = await chargeback(shop.id, { orderId: order.id });

    const detail = await getDisputeDetail(dispute.id);
    expect(detail).not.toBeNull();
    expect(detail!.dispute.id).toBe(dispute.id);
    expect(detail!.shop?.id).toBe(shop.id);
    expect(detail!.order?.id).toBe(order.id);
    expect(detail!.owner?.email).toContain("@");
    expect(detail!.files).toEqual([]);
    // No files attached, so none of the 4.5 MB budget is spent.
    expect(detail!.budget.usedBytes).toBe(0);

    expect(await getDisputeDetail(uid())).toBeNull();
  });

  it("gives an account page every dispute for one shop", async () => {
    const shop = await sellerShop();
    const order = await paidOrder(shop.id);
    await chargeback(shop.id, { orderId: order.id });
    await chargeback(shop.id, { status: "won", dueBy: null });

    const rows = await getShopDisputes(shop.id);
    expect(rows).toHaveLength(2);
    // Open first: `dueBy asc nulls last`, and a won case has no deadline left.
    expect(rows[0]!.open).toBe(true);
    expect(rows[0]!.reasonLabel).toBeTruthy();
    expect(rows[0]!.daysLeft).not.toBeNull();
    expect(rows[1]!.open).toBe(false);
    expect(rows[1]!.outcome).toBe("won");

    // Scoped to the shop asked about, and to no other.
    const other = await sellerShop();
    expect(await getShopDisputes(other.id)).toHaveLength(0);
  });

  it("keeps a deleted order's chargeback on the shop's record", async () => {
    /*
     * `on delete set null`, not cascade. A dispute is a fact a bank reported and
     * it outlives the row it was about — deleting the order must not erase the
     * chargeback from the shop's rate, which is the one measurement that
     * detects a bad seller.
     */
    const shop = await sellerShop();
    const order = await paidOrder(shop.id);
    const dispute = await chargeback(shop.id, { orderId: order.id });

    await db.delete(orders).where(eq(orders.id, order.id));

    const rows = await getShopDisputes(shop.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(dispute.id);
    expect(rows[0]!.orderId).toBeNull();
  });
});
