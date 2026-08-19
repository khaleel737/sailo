import type Stripe from "stripe";
import type * as disputesApi from "@sailo/payments/disputes";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  disputes,
  downloadEvents,
  orderItems,
  orders,
  paymentMethods,
  products,
  shops,
  user,
} from "@sailo/db/schema";

/**
 * Chargebacks, end to end, against real rows.
 *
 * Everything worth getting wrong about a dispute is invisible to a unit test,
 * because it is about *rows and money*: whether an inquiry moves an order,
 * whether five webhooks become five rows, whether a dispute is counted against
 * the month its order was placed or the month it arrived, and whether a payout
 * is held before the money leaves.
 *
 * The Stripe calls are stubbed at the module boundary — `holdPayouts` and
 * `readBalance` reach an API this fixture has no account on. Everything else is
 * production code: the route's own handler, the recorder, the cohort SQL, the
 * escalation ladder and the evidence assembly all run for real.
 *
 * Every assertion here corresponds to a defect found in this pass, and the ones
 * about inquiries were verified against Stripe's live test mode first — see the
 * table in `lifecycle.test.ts`.
 */

/** Payout calls the escalation made, in order. */
const payoutCalls: { fn: string; accountId: string; interval?: string | null }[] = [];

/** What the connected account is holding. Set per test. */
let balance = { currency: "USD", availableCents: 0, pendingCents: 0, negativeCents: 0 };

/** Whether Stripe should accept a payout hold. */
let holdSucceeds = true;

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
    releasePayouts: async (accountId: string, previousInterval: string | null) => {
      payoutCalls.push({ fn: "release", accountId, interval: previousInterval });
      return { ok: true as const, interval: (previousInterval ?? "daily") as "daily" };
    },
    readBalance: async () => balance,
  };
});

/*
 * The seller's mail, recorded rather than sent.
 *
 * This suite is about rows, money and the ladder — `dispute-notices.scenario.ts`
 * is where the notification decisions are tested properly, including the claim
 * that stops a redelivered webhook mailing twice. Stubbing here keeps that cost
 * (an evidence assembly and a mail attempt per dispute event, against a remote
 * branch) out of a suite that raises dozens of disputes, while still pinning the
 * one thing this file should care about: that the webhook calls it at all.
 */
const notices: { fn: string; disputeId: string; status: string }[] = [];

vi.mock("@sailo/workflows/disputes", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notifySellerDisputeOpened: async (row: { id: string; status: string }) => {
    notices.push({ fn: "opened", disputeId: row.id, status: row.status });
  },
  notifySellerDisputeClosed: async (row: { id: string; status: string }) => {
    notices.push({ fn: "closed", disputeId: row.id, status: row.status });
  },
  notifySellerFraudWarning: async () => {
    notices.push({ fn: "fraud_warning", disputeId: "", status: "" });
  },
}));

const { handleDisputeEvent } = await import("@/lib/stripe-webhooks");
const { shopDisputeStats, applyEscalation, releaseHold, holdingsForOrder } =
  await import("@sailo/commerce/disputes");
const { assembleEvidence } = await import("@sailo/core/disputes");
const { getSellerDisputes } = await import("@/lib/seller-disputes");

const db = getDb();
const uid = () => crypto.randomUUID();
const ACCOUNT = "acct_dispute_seller";
const OTHER_ACCOUNT = "acct_dispute_stranger";

beforeAll(async () => {
  assertLocalDatabase();
  /*
   * Clear what earlier runs left behind. Against `up.sh`'s throwaway container
   * this is a no-op; against a Neon dev branch it is what stops the cohort
   * queries — which scan a shop's whole order history — from timing out once the
   * branch has accumulated ten thousand fixture orders.
   */
  await purgeFixtures(["dispute-"]);
});

beforeEach(() => {
  notices.length = 0;
  payoutCalls.length = 0;
  balance = { currency: "USD", availableCents: 0, pendingCents: 0, negativeCents: 0 };
  holdSucceeds = true;
});

async function sellerShop(over: Partial<typeof shops.$inferInsert> = {}) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `dispute-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `dispute-${userId.slice(0, 8)}`,
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

  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type: "card",
    label: "card",
    config: {} as never,
    isEnabled: true,
    position: 0,
  });
  return shop;
}

/** A settled card order, as the webhook leaves one. */
async function paidOrder(
  shopId: string,
  over: Partial<typeof orders.$inferInsert> = {},
) {
  const intent = `pi_${uid().replace(/-/g, "")}`;
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
      addressLine1: "12 Bridge St",
      city: "Bristol",
      postalCode: "BS1 4ND",
      country: "GB",
      buyerIp: "203.0.113.42",
      buyerUserAgent: "Mozilla/5.0 (Macintosh)",
      termsAcceptedAt: new Date(),
      paymentMethod: "card",
      paymentStatus: "paid",
      status: "confirmed",
      stripePaymentIntentId: intent,
      stripeAccountId: ACCOUNT,
      ...over,
    })
    .returning();
  if (!order) throw new Error("fixture: order was not inserted");

  await db.insert(orderItems).values({
    orderId: order.id,
    title: "Speckled Mug",
    kind: (over.productKind as string) ?? "physical",
    unitPriceCents: 4200,
    quantity: 1,
    subtotalCents: 4200,
    position: 0,
  });
  return { order, intent };
}

/**
 * A dispute event, in the exact shape Stripe produces.
 *
 * The two presets below were copied from live test-mode responses on
 * 17 August 2026 rather than written from the docs — `pm_card_createDispute`
 * and `pm_card_createDisputeInquiry` against a $42 direct charge on a connected
 * account. The `net: -5700` and the empty `balance_transactions` are the
 * observed values, not invented ones.
 */
function disputeEvent(opts: {
  type: string;
  intent: string;
  status: string;
  caseType: "chargeback" | "inquiry";
  reason?: string;
  amountCents?: number;
  disputeId?: string;
  createdAt?: Date;
  networkReasonCode?: string;
  enhancedEligibilityTypes?: string[];
  charge?: string;
}): Stripe.Event {
  const amount = opts.amountCents ?? 4200;
  const chargeback = opts.caseType === "chargeback";
  const created = opts.createdAt ?? new Date();

  return {
    id: `evt_${uid().replace(/-/g, "")}`,
    type: opts.type,
    created: Math.floor(created.getTime() / 1000),
    data: {
      object: {
        id: opts.disputeId ?? `du_${uid().replace(/-/g, "")}`,
        object: "dispute",
        amount,
        currency: "usd",
        charge: opts.charge ?? `ch_${uid().replace(/-/g, "")}`,
        payment_intent: opts.intent,
        reason: opts.reason ?? "fraudulent",
        status: opts.status,
        created: Math.floor(created.getTime() / 1000),
        is_charge_refundable: !chargeback,
        enhanced_eligibility_types: opts.enhancedEligibilityTypes ?? [],
        balance_transactions: chargeback
          ? [
              {
                id: `txn_${uid().replace(/-/g, "")}`,
                object: "balance_transaction",
                amount: -amount,
                fee: 1500,
                net: -(amount + 1500),
                currency: "usd",
                reporting_category: "dispute",
                type: "adjustment",
              },
            ]
          : [],
        evidence_details: {
          due_by: Math.floor((created.getTime() + 20 * 86_400_000) / 1000),
          has_evidence: false,
          past_due: false,
          submission_count: 0,
          enhanced_eligibility: {},
        },
        payment_method_details: {
          type: "card",
          card: {
            brand: "visa",
            network: "visa",
            case_type: opts.caseType,
            network_reason_code: opts.networkReasonCode ?? (chargeback ? "10.4" : "10"),
          },
        },
      } as unknown as Stripe.Dispute,
    },
  } as Stripe.Event;
}

/**
 * A cohort of settled card orders, backdated, in one statement.
 *
 * Written as a bulk insert because the obvious version — call `paidOrder` in a
 * loop and update each row's date — is three HTTP round trips per order through
 * the Neon proxy, and a 400-order cohort is 1,200 of them. The first draft of
 * this file did exactly that and timed out at thirty seconds on every rate test.
 *
 * `createdAt` is written directly: it is the column the cohort query groups on,
 * and there is no other way to have history. No `orderItems` either — nothing
 * about a rate reads them, and they double the cost.
 */
async function cohortOrders(
  shopId: string,
  monthsAgo: number,
  count: number,
  over: Partial<typeof orders.$inferInsert> = {},
): Promise<string[]> {
  const at = new Date();
  at.setUTCMonth(at.getUTCMonth() - monthsAgo, 15);

  const rows = Array.from({ length: count }, () => ({
    shopId,
    productTitle: "Speckled Mug",
    productKind: "physical",
    quantity: 1,
    unitPriceCents: 4200,
    subtotalCents: 4200,
    totalCents: 4200,
    currency: "USD",
    customerEmail: `ada-${uid().slice(0, 8)}@example.com`,
    paymentMethod: "card",
    paymentStatus: "paid",
    status: "confirmed",
    stripePaymentIntentId: `pi_${uid().replace(/-/g, "")}`,
    stripeAccountId: ACCOUNT,
    createdAt: at,
    ...over,
  }));

  const inserted = await db
    .insert(orders)
    .values(rows)
    .returning({ intent: orders.stripePaymentIntentId });
  return inserted.map((row) => row.intent!).filter(Boolean);
}

const orderRow = (id: string) =>
  db.query.orders.findFirst({ where: eq(orders.id, id) });
const shopRow = (id: string) =>
  db.query.shops.findFirst({ where: eq(shops.id, id) });
const disputeRows = (shopId: string) =>
  db.select().from(disputes).where(eq(disputes.shopId, shopId));

/* ------------------------------------------------------------------------- */

describe("an inquiry is not a chargeback", () => {
  it("does not mark the order disputed", async () => {
    /*
     * The bug. `charge.dispute.created` fires for both, and the old handler set
     * `disputed` either way — telling a seller money had left their balance when
     * `balance_transactions` was empty and `is_charge_refundable` was true.
     * `SELLER_SETTABLE_PAYMENT_STATUSES` then forbade them from correcting it.
     */
    const shop = await sellerShop();
    const { order, intent } = await paidOrder(shop.id);

    const outcome = await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "warning_needs_response",
        caseType: "inquiry",
      }),
      ACCOUNT,
    );

    expect(outcome).toContain("inquiry");
    const after = await orderRow(order.id);
    expect(after?.paymentStatus).toBe("paid");
  });

  it("records no deduction, because no money moved", async () => {
    const shop = await sellerShop();
    const { intent } = await paidOrder(shop.id);

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "warning_needs_response",
        caseType: "inquiry",
      }),
      ACCOUNT,
    );

    const [row] = await disputeRows(shop.id);
    expect(row?.deductedCents).toBe(0);
    expect(row?.feeCents).toBe(0);
    expect(row?.fundsWithdrawnAt).toBeNull();
    expect(row?.caseType).toBe("inquiry");
  });

  it("a closed inquiry does not refund the order or restock it", async () => {
    /*
     * The second half of the bug, and the expensive one. The old branch was
     * `won = status === "won"`, so `warning_closed` — an inquiry that closed
     * with no chargeback behind it, which is the *good* outcome — took the
     * losing side: the order was marked refunded and its stock went back on the
     * shelf, on a sale the seller had been paid for and still held.
     */
    const shop = await sellerShop();
    const { order, intent } = await paidOrder(shop.id);
    const disputeId = `du_${uid().replace(/-/g, "")}`;

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "warning_needs_response",
        caseType: "inquiry",
        disputeId,
      }),
      ACCOUNT,
    );
    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.closed",
        intent,
        status: "warning_closed",
        caseType: "inquiry",
        disputeId,
        createdAt: new Date(Date.now() + 60_000),
      }),
      ACCOUNT,
    );

    const after = await orderRow(order.id);
    expect(after?.paymentStatus).toBe("paid");
    expect(after?.status).toBe("confirmed");
    expect(after?.refundedCents).toBe(0);
    expect(after?.restockedAt).toBeNull();
  });

  it("is never counted into a rate", async () => {
    const shop = await sellerShop();
    for (let i = 0; i < 5; i++) {
      const { intent } = await paidOrder(shop.id);
      await handleDisputeEvent(
        disputeEvent({
          type: "charge.dispute.created",
          intent,
          status: "warning_needs_response",
          caseType: "inquiry",
        }),
        ACCOUNT,
      );
    }

    const stats = await shopDisputeStats(shop.id);
    /*
     * `allTally`, not `tally`. These orders were placed this month, so their
     * cohort is immature and `pooledRate` excludes it — correctly, because a
     * shop must not be able to dilute a bad history by launching a big month.
     * A seller still has to see the five enquiries that arrived this week, which
     * is the whole reason the two tallies are separate. This assertion is why
     * `allTally` exists: the first draft asserted on `tally` and found zero.
     */
    expect(stats.allTally.inquiries).toBe(5);
    expect(stats.allTally.chargebacks).toBe(0);
    expect(stats.chargebackBp).toBeNull();
  });
});

describe("a chargeback", () => {
  it("marks the order disputed and records the real deduction", async () => {
    /*
     * $42 + $15 dispute fee = $57. `dispute.amount` alone is 4200 and a seller
     * shown that number is being told their loss is 36% smaller than it was.
     */
    const shop = await sellerShop();
    const { order, intent } = await paidOrder(shop.id);

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "needs_response",
        caseType: "chargeback",
      }),
      ACCOUNT,
    );

    const after = await orderRow(order.id);
    expect(after?.paymentStatus).toBe("disputed");

    const [row] = await disputeRows(shop.id);
    expect(row?.amountCents).toBe(4200);
    expect(row?.feeCents).toBe(1500);
    expect(row?.deductedCents).toBe(5700);
    expect(row?.fundsWithdrawnAt).not.toBeNull();
    expect(row?.networkReasonCode).toBe("10.4");
    expect(row?.dueBy).not.toBeNull();
  });

  it("restocks and refunds only once it is lost", async () => {
    const shop = await sellerShop();
    const disputeId = `du_${uid().replace(/-/g, "")}`;
    const [product] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Speckled Mug",
        slug: `mug-${uid().slice(0, 8)}`,
        priceCents: 4200,
        // `stockQuantity`, not `stock` — the tracked count. `inStock` beside it
        // is the seller's own on/off switch and does not decrement.
        stockQuantity: 3,
        inStock: true,
      })
      .returning();
    const { order, intent } = await paidOrder(shop.id, { productId: product!.id });

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "needs_response",
        caseType: "chargeback",
        disputeId,
      }),
      ACCOUNT,
    );

    // Open, so the goods stay off the shelf: the shop may still win and ship.
    let after = await orderRow(order.id);
    expect(after?.restockedAt).toBeNull();
    expect(after?.status).toBe("confirmed");

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.closed",
        intent,
        status: "lost",
        caseType: "chargeback",
        disputeId,
        createdAt: new Date(Date.now() + 60_000),
      }),
      ACCOUNT,
    );

    after = await orderRow(order.id);
    expect(after?.paymentStatus).toBe("refunded");
    expect(after?.status).toBe("refunded");
    expect(after?.refundedCents).toBe(4200);
    expect(after?.restockedAt).not.toBeNull();
  });

  it("puts a won order back to paid", async () => {
    const shop = await sellerShop();
    const disputeId = `du_${uid().replace(/-/g, "")}`;
    const { order, intent } = await paidOrder(shop.id);

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "needs_response",
        caseType: "chargeback",
        disputeId,
      }),
      ACCOUNT,
    );
    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.closed",
        intent,
        status: "won",
        caseType: "chargeback",
        disputeId,
        createdAt: new Date(Date.now() + 60_000),
      }),
      ACCOUNT,
    );

    const after = await orderRow(order.id);
    expect(after?.paymentStatus).toBe("paid");
    expect(after?.refundReason).toBeNull();

    const [row] = await disputeRows(shop.id);
    expect(row?.status).toBe("won");
    // The withdrawal date survives the win: the money did leave, in a month
    // somebody's accounts have to balance.
    expect(row?.fundsWithdrawnAt).not.toBeNull();
    expect(row?.fundsReinstatedAt).not.toBeNull();
  });
});

describe("the seller is told", () => {
  /*
   * The wiring only. Whether the mail is idempotent, addressed correctly, or
   * says the right thing is `dispute-notices.scenario.ts` — what matters here is
   * that the webhook reaches the notifier at all, because that is the seam that
   * silently did not exist until this pass: everything else about a chargeback
   * worked, and the person holding the proof of delivery was never told.
   */
  it("when a chargeback opens", async () => {
    const shop = await sellerShop();
    const { order, intent } = await paidOrder(shop.id);

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "needs_response",
        caseType: "chargeback",
      }),
      ACCOUNT,
    );

    expect(notices.map((n) => n.fn)).toEqual(["opened"]);
    expect(order.id).toBeTruthy();
  });

  it("and when it closes, with the outcome rather than the deadline", async () => {
    /*
     * Which message is chosen by the *status*, not the event type. A `closed`
     * carrying `won` and an `updated` carrying `won` are the same fact, and a
     * seller told "you have 20 days" about a case that is already over would be
     * sent to do work that cannot be done.
     */
    const shop = await sellerShop();
    const { intent } = await paidOrder(shop.id);
    const disputeId = `du_${uid().replace(/-/g, "")}`;

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "needs_response",
        caseType: "chargeback",
        disputeId,
      }),
      ACCOUNT,
    );
    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.closed",
        intent,
        status: "won",
        caseType: "chargeback",
        disputeId,
        createdAt: new Date(Date.now() + 60_000),
      }),
      ACCOUNT,
    );

    expect(notices.map((n) => n.fn)).toEqual(["opened", "closed"]);
    expect(notices[1]?.status).toBe("won");
  });

  it("but not about a seller's own subscription chargeback", async () => {
    /*
     * A platform dispute is the seller charging back their Sailo invoice. They
     * started it; mailing them "a buyer disputed a payment" would be both wrong
     * and confusing. The scope check lives in the notifier, but the platform
     * path does not even reach it.
     */
    const shop = await sellerShop();
    await db
      .update(shops)
      .set({ stripeCustomerId: `cus_${uid().slice(0, 12)}` })
      .where(eq(shops.id, shop.id));

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent: `pi_${uid().replace(/-/g, "")}`,
        status: "needs_response",
        caseType: "chargeback",
      }),
      null,
    );

    expect(notices).toHaveLength(0);
  });
});

describe("five events, one dispute", () => {
  it("does not become five rows", async () => {
    /*
     * `created`, `updated`, `funds_withdrawn`, `closed` and `funds_reinstated`
     * all describe one dispute under five different event ids, so the
     * `stripeEvents` claim in the route does not cover them. Five rows is a
     * dispute rate five times its real value, which would hold a seller's
     * payouts for arithmetic.
     */
    const shop = await sellerShop();
    const disputeId = `du_${uid().replace(/-/g, "")}`;
    const { intent } = await paidOrder(shop.id);
    const base = Date.now();

    const sequence: [string, string][] = [
      ["charge.dispute.created", "needs_response"],
      ["charge.dispute.funds_withdrawn", "needs_response"],
      ["charge.dispute.updated", "under_review"],
      ["charge.dispute.closed", "won"],
      ["charge.dispute.funds_reinstated", "won"],
    ];

    for (const [index, [type, status]] of sequence.entries()) {
      await handleDisputeEvent(
        disputeEvent({
          type,
          intent,
          status,
          caseType: "chargeback",
          disputeId,
          createdAt: new Date(base + index * 60_000),
        }),
        ACCOUNT,
      );
    }

    const rows = await disputeRows(shop.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("won");
  });

  it("refuses to reopen a dispute a late retry describes as open", async () => {
    /*
     * Stripe delivers at least once and in no guaranteed order, so an `updated`
     * carrying `needs_response` can land after the `closed` carrying `won`.
     * Applying it would put the deadline back on the seller's dashboard and,
     * through `fundsWithdrawn`, tell them reinstated money was gone again.
     */
    const shop = await sellerShop();
    const disputeId = `du_${uid().replace(/-/g, "")}`;
    const { order, intent } = await paidOrder(shop.id);
    const base = Date.now();

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "needs_response",
        caseType: "chargeback",
        disputeId,
        createdAt: new Date(base),
      }),
      ACCOUNT,
    );
    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.closed",
        intent,
        status: "won",
        caseType: "chargeback",
        disputeId,
        createdAt: new Date(base + 120_000),
      }),
      ACCOUNT,
    );

    const stale = await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.updated",
        intent,
        status: "needs_response",
        caseType: "chargeback",
        disputeId,
        createdAt: new Date(base + 60_000),
      }),
      ACCOUNT,
    );

    expect(stale).toContain("stale");
    const [row] = await disputeRows(shop.id);
    expect(row?.status).toBe("won");
    expect((await orderRow(order.id))?.paymentStatus).toBe("paid");
  });
});

describe("ownership", () => {
  it("will not let one seller's dispute touch another seller's order", async () => {
    /*
     * The seam every webhook handler passes through. A connected account is
     * controlled by a seller, and a seller is not a trusted party — so an event
     * naming an order is not evidence that the order's seller sent it. The first
     * draft of the dispute handler ran its own unscoped `findFirst` and was
     * caught by `stripe-webhooks.test.ts`, which counts those lookups.
     */
    const shop = await sellerShop();
    const { order, intent } = await paidOrder(shop.id);

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "needs_response",
        caseType: "chargeback",
      }),
      OTHER_ACCOUNT,
    );

    // Untouched: the order belongs to ACCOUNT.
    expect((await orderRow(order.id))?.paymentStatus).toBe("paid");
    expect(await disputeRows(shop.id)).toHaveLength(0);
  });
});

describe("the dispute rate", () => {
  it("counts a dispute against the month its order was placed, not the month it arrived", async () => {
    /*
     * The trap, with real rows. A seller running genuine fraud while growing:
     * 100 orders five months ago carrying 6 chargebacks, then 900 clean orders
     * this month. The disputes all *arrive* now.
     *
     * The arithmetic is chosen so the two answers fall on opposite sides of the
     * ladder rather than merely differing:
     *
     *   arrival-month  6 / 1000 =  60bp — under the 75bp review threshold. Clean.
     *   cohort         6 /  100 = 600bp — over the 150bp hold. Payouts held.
     *
     * Same six disputes, same shop, same day. One query says leave them alone.
     */
    const shop = await sellerShop();
    const old = await cohortOrders(shop.id, 5, 100);
    await cohortOrders(shop.id, 0, 900);

    for (const intent of old.slice(0, 6)) {
      await handleDisputeEvent(
        disputeEvent({
          type: "charge.dispute.created",
          intent,
          status: "needs_response",
          caseType: "chargeback",
        }),
        ACCOUNT,
      );
    }

    const stats = await shopDisputeStats(shop.id);
    expect(stats.tally.chargebacks).toBe(6);
    // 100 mature orders, not 1000: this month's have not had time to be disputed.
    expect(stats.settledOrders).toBe(100);
    expect(stats.chargebackBp).toBe(600);

    // And the figure an arrival-month query would have produced, spelled out so
    // the difference is in the diff rather than in a comment.
    expect(Math.round((6 / 1000) * 10_000)).toBe(60);
  });

  it("withholds a rate below the floor", async () => {
    // One chargeback on eight orders is 1,250bp and means nothing. This is the
    // hobbyist with one angry customer that the floor exists to protect.
    const shop = await sellerShop();
    const made = await cohortOrders(shop.id, 5, 8);
    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent: made[0]!,
        status: "needs_response",
        caseType: "chargeback",
      }),
      ACCOUNT,
    );

    const stats = await shopDisputeStats(shop.id);
    expect(stats.tally.chargebacks).toBe(1);
    expect(stats.chargebackBp).toBeNull();
  });

  it("excludes unpaid orders from the denominator", async () => {
    /*
     * A third of card sessions are abandoned. Counting them understates every
     * rate by roughly a third — on the side that matters.
     */
    const shop = await sellerShop();
    await cohortOrders(shop.id, 5, 30);
    await cohortOrders(shop.id, 5, 60, { paymentStatus: "unpaid", status: "new" });

    const stats = await shopDisputeStats(shop.id);
    expect(stats.settledOrders).toBe(30);
  });

  it("excludes cash orders, which cannot be charged back", async () => {
    /*
     * A shop taking 60 cash-on-delivery orders and 30 card orders has a card
     * dispute rate over 30, not over 90. Counting the cash reports a third of
     * the truth, on exactly the shops most likely to be selling into cash
     * markets.
     */
    const shop = await sellerShop();
    await cohortOrders(shop.id, 5, 30);
    await cohortOrders(shop.id, 5, 60, {
      paymentMethod: "cod",
      stripePaymentIntentId: null,
    });

    const stats = await shopDisputeStats(shop.id);
    expect(stats.settledOrders).toBe(30);
  });
});

/*
 * The heaviest block in the suite, and the only one that needs more than the
 * default half-minute.
 *
 * Each test builds a whole cohort — up to sixty orders — and then drives a
 * chargeback through the *real* webhook handler for each one it needs, in
 * sequence, because the ladder is about what the nth dispute does that the
 * (n-1)th did not. That is several hundred round trips, and against the remote
 * dev branch these suites usually point at, a round trip is not free.
 *
 * The timeout is about the fixture, not the code under test: the same work
 * against a co-located database finishes in a fraction of it.
 */
describe("the escalation ladder", { timeout: 120_000 }, () => {
  async function shopAtRate(chargebacks: number, ordersInCohort: number) {
    const shop = await sellerShop();
    const made = await cohortOrders(shop.id, 5, ordersInCohort);
    for (let i = 0; i < chargebacks; i++) {
      await handleDisputeEvent(
        disputeEvent({
          type: "charge.dispute.created",
          intent: made[i]!,
          status: "needs_response",
          caseType: "chargeback",
        }),
        ACCOUNT,
      );
    }
    return shop;
  }

  it("holds payouts and leaves the storefront open", async () => {
    /*
     * The whole ordering. Closing a shop stops future orders, which is not where
     * the exposure is — the exposure is the balance about to be paid out.
     *
     * The balance is set to cover the six open disputes on purpose. Both rules
     * end in a payout hold, and with an empty balance the *exposure* rule fires
     * first — 6 × $57 is $342, over the $250 shortfall threshold — which is
     * correct behaviour and not what this test is about. Covering the disputes
     * leaves the rate as the only thing that can trip it.
     */
    balance = {
      currency: "USD",
      availableCents: 100_000,
      pendingCents: 0,
      negativeCents: 0,
    };
    const shop = await shopAtRate(6, 100);
    const after = await shopRow(shop.id);

    expect(after?.payoutsPausedAt).not.toBeNull();
    expect(after?.payoutsPausedReason).toContain("6 chargebacks on 100 settled orders");
    expect(after?.payoutsPausedReason).toContain("the storefront stays open");

    // And the storefront really is open.
    expect(after?.suspendedAt).toBeNull();
    expect(after?.isPublished).toBe(true);
    expect(after?.stripeChargesEnabled).toBe(true);

    expect(payoutCalls.filter((c) => c.fn === "hold")).toHaveLength(1);
  });

  it("remembers the seller's payout interval so releasing restores it", async () => {
    const shop = await shopAtRate(6, 100);
    expect((await shopRow(shop.id))?.payoutIntervalBeforeHold).toBe("weekly");

    const fresh = await shopRow(shop.id);
    await releaseHold(fresh!, { clear: true });

    const released = await shopRow(shop.id);
    expect(released?.payoutsPausedAt).toBeNull();
    expect(released?.disputeClearedAt).not.toBeNull();
    expect(payoutCalls.at(-1)).toMatchObject({ fn: "release", interval: "weekly" });
  });

  it("does not flag a shop that is merely below the line", async () => {
    // 2 chargebacks on 400 orders is 50bp — under the 75bp review threshold.
    const shop = await shopAtRate(2, 400);
    const after = await shopRow(shop.id);
    expect(after?.payoutsPausedAt).toBeNull();
    expect(payoutCalls).toHaveLength(0);
  });

  it("leaves the hold off when Stripe refuses it", async () => {
    /*
     * A shop marked as held whose payouts are still running is worse than one
     * marked as running, because the next person to look believes the money is
     * safe.
     */
    holdSucceeds = false;
    const shop = await shopAtRate(6, 100);
    const after = await shopRow(shop.id);
    expect(after?.payoutsPausedAt).toBeNull();
  });

  it("assesses a shop even when the dispute has no Sailo order", async () => {
    /*
     * Found by a live run, not by this suite. A real $500 chargeback landed on a
     * connected account, was recorded against the right shop with the right $515
     * deduction — and the shop was never assessed, because the handler returned
     * early when no order matched and the escalation sat below that return.
     *
     * The case is ordinary: a seller takes a payment from Stripe's own dashboard,
     * or the order row was deleted. Sailo is still the losses collector for that
     * balance, so a shop accumulating chargebacks outside its own checkout was
     * exactly the shape this feature exists to catch, and exactly the shape it
     * could not see.
     */
    /*
     * Its own connected account, unlike every other fixture here.
     *
     * With no order to match, the shop is resolved from the account — and every
     * other shop in this suite shares `ACCOUNT`, so a shared id would file this
     * dispute against whichever fixture shop was created first. Nothing makes
     * `shops.stripeAccountId` unique (see the note on the column), which is
     * exactly why `locate` orders its lookup: arbitrary is bad, but unstable
     * would be worse.
     */
    const account = `acct_lone_${uid().slice(0, 8)}`;
    const shop = await sellerShop({ stripeAccountId: account });

    await handleDisputeEvent(
      disputeEvent({
        // An intent no order carries.
        type: "charge.dispute.created",
        intent: `pi_${uid().replace(/-/g, "")}`,
        status: "needs_response",
        caseType: "chargeback",
        amountCents: 90_000,
      }),
      account,
    );

    // Recorded against the shop, resolved from the connected account.
    const [row] = await disputeRows(shop.id);
    expect(row?.orderId).toBeNull();
    expect(row?.deductedCents).toBe(91_500);

    // And assessed: $915 of exposure against an empty balance.
    const after = await shopRow(shop.id);
    expect(after?.payoutsPausedAt).not.toBeNull();
    expect(after?.payoutsPausedReason).toContain("Sailo would cover");
  });

  it("holds on exposure alone, with no rate at all", async () => {
    /*
     * The case a ratio cannot see: one large disputed order on a shop with no
     * history. There is no rate — the floor withholds it — and the money is
     * leaving on the next payout run.
     */
    const shop = await sellerShop();
    const { intent } = await paidOrder(shop.id, {
      totalCents: 90_000,
      unitPriceCents: 90_000,
      subtotalCents: 90_000,
    });

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "needs_response",
        caseType: "chargeback",
        amountCents: 90_000,
      }),
      ACCOUNT,
    );

    const after = await shopRow(shop.id);
    expect(after?.payoutsPausedAt).not.toBeNull();
    expect(after?.payoutsPausedReason).toContain("Sailo would cover");
  });

  it("does not hold when the seller's balance covers the dispute", async () => {
    balance = {
      currency: "USD",
      availableCents: 200_000,
      pendingCents: 0,
      negativeCents: 0,
    };
    const shop = await sellerShop();
    const { intent } = await paidOrder(shop.id, {
      totalCents: 90_000,
      unitPriceCents: 90_000,
      subtotalCents: 90_000,
    });

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "needs_response",
        caseType: "chargeback",
        amountCents: 90_000,
      }),
      ACCOUNT,
    );

    expect((await shopRow(shop.id))?.payoutsPausedAt).toBeNull();
  });

  it("never suspends a storefront, at any rate", async () => {
    /*
     * 12 chargebacks on 60 orders is 2,000bp — more than an order of magnitude
     * over the hold threshold, and past the point `suspensionWarranted` starts
     * saying so.
     *
     * Sixty orders and not thirty, because `RATE_FLOORS.payoutHold` wants fifty
     * settled orders before a *rate* may hold a payout. The first draft used
     * thirty and the hold never applied — which is the floor working, and worth
     * recording: at 4,000bp on thirty orders this shop is reviewed by a human
     * and its payouts keep running, because thirty orders is not enough trading
     * history for a ratio to take money on.
     *
     * Twelve disputes rather than sixty because every dispute event runs a full
     * escalation, and sixty of them times the suite out without proving anything
     * the twelfth did not. The exhaustive version of this guarantee — that no
     * combination of facts returns `suspend` — is pinned in `escalation.test.ts`,
     * where it costs nothing.
     */
    balance = {
      currency: "USD",
      availableCents: 500_000,
      pendingCents: 0,
      negativeCents: 0,
    };
    const shop = await shopAtRate(12, 60);
    const after = await shopRow(shop.id);
    expect(after?.suspendedAt).toBeNull();
    expect(after?.isPublished).toBe(true);
    // But it does say so, so a human can.
    const outcome = await applyEscalation(after!);
    expect(outcome.suspensionWarranted).toBe(true);
    expect(outcome.decision.level).not.toBe("suspend");
  });
});

describe("a seller charging back their own subscription", () => {
  it("is recorded rather than dropped", async () => {
    /*
     * The gap. The platform route sent every `charge.dispute.*` to the connected
     * handler, which found no order and returned "order not found" with a 200 —
     * so a seller could reverse a $468 annual invoice, keep the Business plan
     * indefinitely, and nothing anywhere recorded it.
     */
    const shop = await sellerShop();
    const event = disputeEvent({
      type: "charge.dispute.created",
      intent: `pi_${uid().replace(/-/g, "")}`,
      status: "needs_response",
      caseType: "chargeback",
      amountCents: 46_800,
    });
    (event.data.object as unknown as { charge: Stripe.Charge }).charge = {
      id: `ch_${uid().replace(/-/g, "")}`,
      object: "charge",
      customer: shop.stripeCustomerId,
      metadata: { shopId: shop.id },
    } as unknown as Stripe.Charge;

    const outcome = await handleDisputeEvent(event, null);
    expect(outcome).toContain("platform chargeback");

    const [row] = await disputeRows(shop.id);
    expect(row?.scope).toBe("platform");
    expect(row?.amountCents).toBe(46_800);
    expect(row?.deductedCents).toBe(48_300);
  });

  it("leaves the plan alone while the case is open", async () => {
    const shop = await sellerShop();
    const event = disputeEvent({
      type: "charge.dispute.created",
      intent: `pi_${uid().replace(/-/g, "")}`,
      status: "needs_response",
      caseType: "chargeback",
    });
    (event.data.object as unknown as { charge: Stripe.Charge }).charge = {
      id: `ch_${uid().replace(/-/g, "")}`,
      object: "charge",
      customer: shop.stripeCustomerId,
      metadata: { shopId: shop.id },
    } as unknown as Stripe.Charge;

    await handleDisputeEvent(event, null);
    expect((await shopRow(shop.id))?.plan).toBe("business");
  });

  it("moves the shop to free once the chargeback is lost", async () => {
    const shop = await sellerShop();
    const disputeId = `du_${uid().replace(/-/g, "")}`;
    const intent = `pi_${uid().replace(/-/g, "")}`;
    const chargeId = `ch_${uid().replace(/-/g, "")}`;

    const make = (status: string, at: number) => {
      const event = disputeEvent({
        type: status === "lost" ? "charge.dispute.closed" : "charge.dispute.created",
        intent,
        status,
        caseType: "chargeback",
        disputeId,
        createdAt: new Date(Date.now() + at),
      });
      (event.data.object as unknown as { charge: Stripe.Charge }).charge = {
        id: chargeId,
        object: "charge",
        customer: shop.stripeCustomerId,
        metadata: { shopId: shop.id },
      } as unknown as Stripe.Charge;
      return event;
    };

    await handleDisputeEvent(make("needs_response", 0), null);
    await handleDisputeEvent(make("lost", 60_000), null);

    const after = await shopRow(shop.id);
    expect(after?.plan).toBe("free");
    expect(after?.stripeSubscriptionId).toBeNull();
  });

  it("does not count a subscription chargeback in the storefront's rate", async () => {
    /*
     * A seller's billing argument must never read as their buyers' fraud, and
     * must never be able to hold their payouts.
     */
    const shop = await sellerShop();
    await cohortOrders(shop.id, 5, 100);

    for (let i = 0; i < 6; i++) {
      const event = disputeEvent({
        type: "charge.dispute.created",
        intent: `pi_${uid().replace(/-/g, "")}`,
        status: "needs_response",
        caseType: "chargeback",
      });
      (event.data.object as unknown as { charge: Stripe.Charge }).charge = {
        id: `ch_${uid().replace(/-/g, "")}`,
        object: "charge",
        customer: shop.stripeCustomerId,
        metadata: { shopId: shop.id },
      } as unknown as Stripe.Charge;
      await handleDisputeEvent(event, null);
    }

    const stats = await shopDisputeStats(shop.id);
    expect(stats.tally.chargebacks).toBe(0);
    expect((await shopRow(shop.id))?.payoutsPausedAt).toBeNull();
  });
});

describe("the evidence a dispute is answered with", () => {
  it("carries the buyer's purchase IP, which nothing could add later", async () => {
    const shop = await sellerShop();
    const { order } = await paidOrder(shop.id);

    const row = await orderRow(order.id);
    const holdings = await holdingsForOrder(row!, shop);
    const evidence = assembleEvidence("fraudulent", holdings);

    expect(evidence.payload.customer_purchase_ip).toBe("203.0.113.42");
    expect(evidence.payload.customer_email_address).toBe(row!.customerEmail);
    expect(evidence.payload.billing_address).toContain("Bristol");
  });

  it("builds a download log for a digital order", async () => {
    /*
     * The whole case on a digital sale. `orders.downloadCount` is a counter and a
     * counter is not a log — an issuer reading "downloaded 3 times" learns
     * nothing they can weigh.
     */
    const shop = await sellerShop();
    const { order } = await paidOrder(shop.id, { productKind: "digital" });

    await db.insert(downloadEvents).values([
      {
        orderId: order.id,
        fileName: "presets.zip",
        ip: "203.0.113.42",
        at: new Date("2026-05-02T10:20:11Z"),
      },
      {
        orderId: order.id,
        fileName: "presets.zip",
        ip: "203.0.113.42",
        at: new Date("2026-05-04T18:02:44Z"),
      },
    ]);

    const row = await orderRow(order.id);
    const holdings = await holdingsForOrder(row!, shop);
    const evidence = assembleEvidence("product_not_received", holdings);

    expect(evidence.payload.access_activity_log).toContain("presets.zip");
    expect(evidence.payload.access_activity_log).toContain("203.0.113.42");
    // The download address matches the purchase address, which is the argument.
    expect(evidence.payload.access_activity_log).toContain(row!.buyerIp!);
    expect(evidence.hasGaps).toBe(false);
  });

  it("reports the gap when a physical order has no proof of delivery", async () => {
    const shop = await sellerShop();
    const { order } = await paidOrder(shop.id);
    const row = await orderRow(order.id);
    const evidence = assembleEvidence(
      "product_not_received",
      await holdingsForOrder(row!, shop),
    );

    expect(evidence.hasGaps).toBe(true);
    expect(evidence.blockedOnSeller).toContain("shipping_documentation");
  });

  it("describes every line of a basket, not just the header", async () => {
    /*
     * A four-line basket described by its header is a product description that
     * does not match the amount charged, which is a gift to the cardholder.
     */
    const shop = await sellerShop();
    const { order } = await paidOrder(shop.id);
    await db.insert(orderItems).values({
      orderId: order.id,
      title: "Glazed Bowl",
      kind: "physical",
      unitPriceCents: 1800,
      quantity: 2,
      subtotalCents: 3600,
      position: 1,
    });

    const row = await orderRow(order.id);
    const holdings = await holdingsForOrder(row!, shop);
    expect(holdings.productDescription).toContain("Speckled Mug");
    expect(holdings.productDescription).toContain("2 × Glazed Bowl");
  });
});

describe("what the seller is shown", () => {
  it("counts open exposure as amount plus fee, and drops it when the case closes", async () => {
    const shop = await sellerShop();
    const disputeId = `du_${uid().replace(/-/g, "")}`;
    const { intent } = await paidOrder(shop.id);

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "needs_response",
        caseType: "chargeback",
        disputeId,
      }),
      ACCOUNT,
    );
    let stats = await shopDisputeStats(shop.id);
    expect(stats.openDisputeCents).toBe(5700);
    expect(stats.awaitingResponse).toBe(1);

    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.closed",
        intent,
        status: "lost",
        caseType: "chargeback",
        disputeId,
        createdAt: new Date(Date.now() + 60_000),
      }),
      ACCOUNT,
    );

    /*
     * A lost dispute's money is gone and is no longer *exposure* — it is a
     * realised loss. Counting it forever would hold a seller's payouts for a
     * case that ended months ago.
     */
    stats = await shopDisputeStats(shop.id);
    expect(stats.openDisputeCents).toBe(0);
    expect(stats.awaitingResponse).toBe(0);
  });
});

/* ------------------------------------------------------------------------- */

describe("what the seller's panel actually queries", () => {
  /*
   * The SQL behind the seller's payments card, run against real rows.
   *
   * The card's JSX is typechecked and its numbers are tested above; what is not
   * covered anywhere else is the query, and this is the kind that typechecks and
   * then throws at runtime.
   *
   * The five /hq queries this block used to cover live in `apps/hq` now, and so
   * do their tests — `apps/hq/e2e/scenarios/dispute-desk.scenario.ts`. They came
   * out because they could not stay: they open with `requireStaff()` from
   * `@/lib/session`, and `@/` means `apps/web/src` in this config. The import
   * that named them was left behind when HQ moved, and because it sits at the
   * top level of the module it failed the *whole file* — all 1,583 lines of
   * chargeback coverage were dark, not just the six tests that needed it.
   */
  it("gives the seller their own disputes, with the gaps they can close", async () => {
    const shop = await sellerShop();
    const { intent } = await paidOrder(shop.id);
    await handleDisputeEvent(
      disputeEvent({
        type: "charge.dispute.created",
        intent,
        status: "needs_response",
        caseType: "chargeback",
        reason: "product_not_received",
      }),
      ACCOUNT,
    );

    const [row] = await getSellerDisputes(shop.id);
    expect(row).toBeDefined();
    expect(row!.deductedCents).toBe(5_700);
    expect(row!.feeCents).toBe(1_500);
    expect(row!.ready).toBe(false);
    /*
     * Only tasks. A missing purchase IP is a gap nobody can close — the buyer's
     * connection existed for one request — and listing it would send a seller
     * looking for something that does not exist.
     */
    expect(row!.missing.length).toBeGreaterThan(0);
    expect(row!.missing.join(" ")).toContain("carrier");
  });

  it("keeps a seller's own subscription chargeback off their payments page", async () => {
    /*
     * A platform dispute is an argument between the seller and Sailo. It has no
     * business on the page where they manage taking money from buyers, and
     * showing it there would read as a buyer having charged them back.
     */
    const shop = await sellerShop();
    const event = disputeEvent({
      type: "charge.dispute.created",
      intent: `pi_${uid().replace(/-/g, "")}`,
      status: "needs_response",
      caseType: "chargeback",
    });
    (event.data.object as unknown as { charge: Stripe.Charge }).charge = {
      id: `ch_${uid().replace(/-/g, "")}`,
      object: "charge",
      customer: shop.stripeCustomerId,
      metadata: { shopId: shop.id },
    } as unknown as Stripe.Charge;
    await handleDisputeEvent(event, null);

    expect(await getSellerDisputes(shop.id)).toHaveLength(0);
  });
});
