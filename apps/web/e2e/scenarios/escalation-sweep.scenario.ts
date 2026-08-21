import type * as disputesApi from "@sailo/payments/disputes";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  disputes,
  earlyFraudWarnings,
  riskFlags,
  shops,
  user,
} from "@sailo/db/schema";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";

/**
 * The hourly backstop, against real rows — the three windows the per-event
 * assessment leaves open, each pinned before and after the sweep closes it:
 *
 *   1. a payout hold Stripe refused, retried only when the *next* chargeback
 *      arrived (which may be weeks away);
 *   2. a balance that drains between dispute events, crossing the exposure
 *      line with no webhook to ride in on;
 *   3. a seller who talks Stripe support into resuming payouts, leaving our
 *      column saying held while the money runs.
 *
 * Plus the two rules the sweep carries with it: early fraud warnings move
 * the ladder before the first real chargeback, and a suspension
 * recommendation lands on the risk desk exactly once.
 *
 * Stripe is stubbed at the same module boundary `disputes.scenario.ts`
 * stubs; the candidates query, the ladder, the flag writes and the clearance
 * arithmetic all run for real.
 */

const payoutCalls: { fn: string; accountId: string }[] = [];
let balance = { currency: "USD", availableCents: 0, pendingCents: 0, negativeCents: 0 };
let holdSucceeds = true;
/** What Stripe says the account's payout schedule is right now. */
let payoutState: { interval: string; heldByUs: boolean } | null = null;

vi.mock("@sailo/payments/disputes", async (importOriginal) => {
  const actual = await importOriginal<typeof disputesApi>();
  return {
    ...actual,
    holdPayouts: async (accountId: string) => {
      payoutCalls.push({ fn: "hold", accountId });
      return holdSucceeds
        ? { ok: true as const, previousInterval: "weekly" as const, alreadyHeld: false }
        : { ok: false as const, error: "stripe said no" };
    },
    releasePayouts: async (accountId: string) => {
      payoutCalls.push({ fn: "release", accountId });
      return { ok: true as const, interval: "weekly" as const };
    },
    readBalance: async () => balance,
    readPayoutState: async () => payoutState,
  };
});

const { reassessShopsAtRisk, applyEscalation, chargebacksSince } = await import(
  "@sailo/commerce/disputes"
);

assertLocalDatabase();

const db = getDb();
const PREFIX = "sweep-";
const ACCOUNT = "acct_sweep_seller";
const uid = () => crypto.randomUUID();

beforeAll(async () => {
  await purgeFixtures([PREFIX]);
  /*
   * The sweep's candidate query is platform-wide, by design. The shared
   * scenario database accumulates other suites' leftovers — held shops and
   * still-open disputes by the dozen — and a sweep that re-assesses each of
   * them (stats + balance per shop) times a test out without telling this
   * file anything. Neutralise them: every other suite purges and rebuilds
   * its own fixtures in its own beforeAll, so nothing here is load-bearing
   * for anybody else.
   */
  await db
    .update(shops)
    .set({ payoutsPausedAt: null, payoutsPausedReason: null })
    .where(isNotNull(shops.payoutsPausedAt));
  await db
    .update(disputes)
    .set({ status: "lost" })
    .where(inArray(disputes.status, ["needs_response", "under_review"]));
});

beforeEach(() => {
  payoutCalls.length = 0;
  balance = { currency: "USD", availableCents: 0, pendingCents: 0, negativeCents: 0 };
  holdSucceeds = true;
  payoutState = null;
});

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
  /* One live holder per connected account — the 0064 uniqueness holds here. */
  const claimed =
    (over as { stripeAccountId?: string | null }).stripeAccountId ?? ACCOUNT;
  if (claimed) {
    await db
      .update(shops)
      .set({ stripeAccountId: null })
      .where(eq(shops.stripeAccountId, claimed));
  }
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `${PREFIX}${userId.slice(0, 8)}`,
      name: "Swept Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      stripeAccountId: ACCOUNT,
      stripeChargesEnabled: true,
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

/** An undecided chargeback with the money already pulled — pure exposure. */
async function openDispute(
  shopId: string,
  over: Partial<typeof disputes.$inferInsert> = {},
) {
  const [row] = await db
    .insert(disputes)
    .values({
      shopId,
      scope: "connected",
      stripeDisputeId: `dp_${uid().replace(/-/g, "")}`,
      stripeAccountId: ACCOUNT,
      amountCents: 30_000,
      feeCents: 1_500,
      deductedCents: 31_500,
      reason: "product_not_received",
      status: "needs_response",
      fundsWithdrawnAt: new Date(),
      stripeCreatedAt: new Date(),
      ...over,
    })
    .returning();
  if (!row) throw new Error("fixture: dispute was not inserted");
  return row;
}

async function liveWarning(shopId: string) {
  await db.insert(earlyFraudWarnings).values({
    shopId,
    stripeWarningId: `issfr_${uid().replace(/-/g, "")}`,
    stripeAccountId: ACCOUNT,
    fraudType: "made_with_stolen_card",
    stripeCreatedAt: new Date(),
  });
}

describe("the failed hold is retried, not forgotten", () => {
  it("holds on the next sweep once Stripe accepts", async () => {
    const shop = await makeShop();
    await openDispute(shop.id);

    // Stripe refuses. The decision stands; the flag is deliberately NOT
    // written, so nothing anywhere says the money is safe when it is not.
    holdSucceeds = false;
    let swept = await reassessShopsAtRisk();
    expect(swept.holdFailures.map((f) => f.shopId)).toContain(shop.id);
    let row = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(row?.payoutsPausedAt).toBeNull();

    // The next hour, Stripe accepts. The window this used to wait for was
    // the next chargeback — weeks, maybe.
    holdSucceeds = true;
    swept = await reassessShopsAtRisk();
    expect(swept.held).toContain(shop.id);
    row = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(row?.payoutsPausedAt).not.toBeNull();
    expect(payoutCalls.filter((c) => c.fn === "hold")).toHaveLength(2);
  });
});

describe("exposure drift between dispute events", () => {
  it("does not hold while the balance covers the open disputes", async () => {
    const shop = await makeShop();
    await openDispute(shop.id);
    balance = { currency: "USD", availableCents: 50_000, pendingCents: 0, negativeCents: 0 };

    const swept = await reassessShopsAtRisk();
    expect(swept.held).not.toContain(shop.id);
    const row = await db.query.shops.findFirst({ where: eq(shops.id, shop.id) });
    expect(row?.payoutsPausedAt).toBeNull();
  });

  it("holds when the balance drains, with no webhook in between", async () => {
    const shop = await makeShop();
    await openDispute(shop.id);
    balance = { currency: "USD", availableCents: 50_000, pendingCents: 0, negativeCents: 0 };
    await reassessShopsAtRisk();

    // A payout run empties the account. No dispute event fires for that.
    balance = { currency: "USD", availableCents: 0, pendingCents: 0, negativeCents: 0 };
    const swept = await reassessShopsAtRisk();
    expect(swept.held).toContain(shop.id);
  });
});

describe("Stripe-side resume drift", () => {
  it("re-holds a shop whose payouts are running behind our held flag", async () => {
    const shop = await makeShop({
      payoutsPausedAt: new Date(),
      payoutsPausedReason: "held in an earlier assessment",
    });
    await openDispute(shop.id);
    // Stripe says the schedule is daily — somebody resumed it over there.
    payoutState = { interval: "daily", heldByUs: false };

    await reassessShopsAtRisk();
    expect(payoutCalls.some((c) => c.fn === "hold")).toBe(true);
  });
});

describe("early fraud warnings move the ladder first", () => {
  it("reaches review on warnings alone, before any chargeback exists", async () => {
    const shop = await makeShop();
    await liveWarning(shop.id);
    await liveWarning(shop.id);
    await liveWarning(shop.id);

    const outcome = await applyEscalation(shop);
    expect(outcome.stats.liveFraudWarnings).toBe(3);
    expect(outcome.decision.level).toBe("review");
  });

  it("stops counting a warning once its dispute arrives", async () => {
    const shop = await makeShop();
    const dispute = await openDispute(shop.id, {
      deductedCents: 0,
      fundsWithdrawnAt: null,
    });
    await db.insert(earlyFraudWarnings).values({
      shopId: shop.id,
      stripeWarningId: `issfr_${uid().replace(/-/g, "")}`,
      stripeAccountId: ACCOUNT,
      fraudType: "made_with_stolen_card",
      stripeCreatedAt: new Date(),
      disputeId: dispute.id,
    });

    const outcome = await applyEscalation(shop);
    // The warning became a dispute; counting both would double it.
    expect(outcome.stats.liveFraudWarnings).toBe(0);
  });
});

describe("clearance counts chargebacks by their own timestamps", () => {
  it("only disputes dated after the clearance break it", async () => {
    const shop = await makeShop();
    const clearedAt = new Date(Date.now() - 3_600_000);
    const before = new Date(clearedAt.getTime() - 86_400_000);
    const after = new Date(clearedAt.getTime() + 60_000);

    await openDispute(shop.id, { stripeCreatedAt: before, deductedCents: 0, fundsWithdrawnAt: null });
    await openDispute(shop.id, { stripeCreatedAt: before, deductedCents: 0, fundsWithdrawnAt: null });
    await openDispute(shop.id, { stripeCreatedAt: after, deductedCents: 0, fundsWithdrawnAt: null });

    expect(await chargebacksSince(shop.id, clearedAt)).toBe(1);
  });
});

describe("the suspension recommendation reaches the desk once", () => {
  it("writes one risk flag however many sweeps agree", async () => {
    // Already held, and six live warnings: `suspensionWarranted` by the
    // emerging path. The old behaviour was a captureMessage nobody is paged
    // for; the sweep files it where staff actually work.
    const shop = await makeShop({
      payoutsPausedAt: new Date(),
      payoutsPausedReason: "held in an earlier assessment",
    });
    payoutState = { interval: "manual", heldByUs: true };
    for (let i = 0; i < 6; i++) await liveWarning(shop.id);

    const first = await reassessShopsAtRisk();
    expect(first.suspensionFlagged).toContain(shop.id);

    const open = await db.query.riskFlags.findMany({
      where: and(eq(riskFlags.shopId, shop.id), isNull(riskFlags.clearedAt)),
    });
    expect(open).toHaveLength(1);
    expect(open[0]?.severity).toBe("act");
    expect(open[0]?.summary).toContain("suspension");

    const second = await reassessShopsAtRisk();
    expect(second.suspensionFlagged).not.toContain(shop.id);
    const still = await db.query.riskFlags.findMany({
      where: and(eq(riskFlags.shopId, shop.id), isNull(riskFlags.clearedAt)),
    });
    expect(still).toHaveLength(1);
  });
});
