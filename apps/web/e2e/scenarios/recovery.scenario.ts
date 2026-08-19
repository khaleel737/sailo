import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  checkoutSessions,
  coupons,
  products,
  shops,
  user,
} from "@sailo/db/schema";
import { suppress } from "@sailo/marketing/broadcasts/server";
import { RECOVERY_AFTER_MS } from "@sailo/commerce/recovery";
import {
  markSessionError,
  markSessionPaid,
  markRevisited,
  openSession,
  readResumeToken,
  resumeToken,
} from "@sailo/commerce/recovery/server";
import { runRecoveryPass } from "@sailo/workflows/recovery";
import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";

/**
 * The checkout somebody walked away from, against real rows.
 *
 * `packages/commerce/src/recovery/rules.test.ts` proves the predicate from
 * object literals. This proves the parts that are not pure and are where the
 * money is: that a revisit does not create a second row, that two passes send
 * **one** email, that a suppressed address is never written to, and that
 * `recovered` is earned only through the link.
 *
 * The transport is stubbed at the module boundary; the pass, the claim, the
 * coupon mint and the status machine all run for real.
 *
 * Run with:
 *   npx dotenv -e .env.local.test -- \
 *     npx vitest run --config vitest.scenarios.mts e2e/scenarios/recovery.scenario.ts
 */

const outbox = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);

vi.mock("@sailo/mailer/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sailo/mailer/transport")>();
  return {
    ...actual,
    send: async (opts: { to: string; subject: string; html: string }) => {
      outbox.push({ to: opts.to, subject: opts.subject, html: opts.html });
      return { sent: true as const, id: `scenario-${outbox.length}` };
    },
  };
});

const db = getDb();
const uid = () => crypto.randomUUID();
const PREFIX = "sc-recovery-";

let shopId: string;
let handle: string;

/** Always awards the discount, so the coupon path is exercised deterministically. */
const alwaysAward = () => 0;
/** Never awards it — the other half of the coin flip. */
const neverAward = () => 0.999;

async function makeShop(over: Record<string, unknown> = {}): Promise<string> {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Recovery Fixture",
    email: `${PREFIX}${userId}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  handle = `${PREFIX}${uid().slice(0, 8)}`;
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      name: "Recovery Fixture",
      handle,
      currency: "USD",
      plan: "pro",
      subscriptionStatus: "active",
      recoveryEnabled: true,
      recoveryDiscountBp: 1_000,
      ...over,
    })
    .returning({ id: shops.id });
  return shop!.id;
}

async function makeProduct(over: Record<string, unknown> = {}): Promise<string> {
  const [row] = await db
    .insert(products)
    .values({
      shopId,
      title: "A mug",
      slug: `mug-${uid().slice(0, 8)}`,
      priceCents: 2_500,
      isPublished: true,
      ...over,
    })
    .returning({ id: products.id });
  return row!.id;
}

/** A session opened `ms` ago, which is how a test makes one due. */
async function openAgo(ms: number, over: Record<string, unknown> = {}) {
  const opened = new Date(Date.now() - ms);
  const session = await openSession({
    shopId,
    visitorKey: uid(),
    email: `${PREFIX}buyer-${uid().slice(0, 6)}@example.com`,
    subtotalCents: 2_500,
    currency: "USD",
    now: opened,
    ...over,
  });
  return session!;
}

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures([PREFIX]);
});

beforeEach(async () => {
  outbox.length = 0;
  shopId = await makeShop();
});

describe("opening a checkout", () => {
  it("writes one row, and a revisit updates it rather than adding another", async () => {
    // Theirs: "if a customer revisits the same checkout from the same device
    // and browser, a new session is not created."
    const visitorKey = uid();
    const productId = await makeProduct();

    const first = await openSession({ shopId, visitorKey, productId, subtotalCents: 2_500 });
    const second = await openSession({ shopId, visitorKey, productId, subtotalCents: 2_500 });

    expect(first?.id).toBe(second?.id);
    const rows = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.shopId, shopId));
    expect(rows).toHaveLength(1);
  });

  it("does not forget an address the buyer typed and then reloaded away", async () => {
    /*
     * The address is the only thing that makes them recoverable, so a revisit
     * carrying an empty form must fill in rather than blank out.
     */
    const visitorKey = uid();
    const productId = await makeProduct();
    const email = `${PREFIX}typed@example.com`;

    await openSession({ shopId, visitorKey, productId, email, subtotalCents: 2_500 });
    const after = await openSession({ shopId, visitorKey, productId, subtotalCents: 2_500 });
    expect(after?.email).toBe(email);
  });

  it("does not reset the clock on a revisit", async () => {
    /*
     * The three-hour clock runs from when they *first* looked. Resetting it
     * would mean the buyer who keeps the tab open and glances at it — the most
     * interested one — is the only one never written to.
     */
    const visitorKey = uid();
    const productId = await makeProduct();
    const long = new Date(Date.now() - 5 * 3_600_000);

    const first = await openSession({
      shopId,
      visitorKey,
      productId,
      subtotalCents: 2_500,
      now: long,
    });
    const second = await openSession({ shopId, visitorKey, productId, subtotalCents: 2_500 });
    expect(second?.openedAt.getTime()).toBe(first?.openedAt.getTime());
  });

  it("keeps a cart checkout and a product checkout apart", async () => {
    // `product_id` is nullable and Postgres treats NULLs as distinct, which is
    // why there are two partial indexes rather than one.
    const visitorKey = uid();
    const productId = await makeProduct();
    await openSession({ shopId, visitorKey, productId, subtotalCents: 2_500 });
    await openSession({ shopId, visitorKey, productId: null, subtotalCents: 5_000 });

    const rows = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.shopId, shopId));
    expect(rows).toHaveLength(2);
  });
});

describe("a failed payment", () => {
  it("moves to `error` and back to `opened` when they return", async () => {
    const session = await openAgo(0);
    await markSessionError({ shopId, sessionId: session.id, decline: "insufficient_funds" });

    let [row] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, session.id));
    expect(row?.status).toBe("error");
    expect(row?.lastError).toBe("insufficient_funds");

    await markRevisited({ shopId, sessionId: session.id });
    [row] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, session.id));
    expect(row?.status).toBe("opened");
    // The reason is kept: it is what explains a session that took three tries.
    expect(row?.lastError).toBe("insufficient_funds");
  });

  it("stores our word for an unrecognised decline, never the provider's", async () => {
    /*
     * The stored string is rendered in the seller's panel. An allowlist means
     * nothing arbitrary is ever stored, let alone displayed.
     */
    const session = await openAgo(0);
    await markSessionError({
      shopId,
      sessionId: session.id,
      decline: "<script>alert(1)</script>",
    });
    const [row] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, session.id));
    expect(row?.lastError).toBe("declined");
  });
});

describe("the recovery pass", () => {
  it("sends one email at three hours, with the discount and the resume link", async () => {
    const session = await openAgo(RECOVERY_AFTER_MS + 60_000);

    const result = await runRecoveryPass(new Date(), alwaysAward);
    expect(result.sent).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.to).toBe(session.email);
    expect(outbox[0]?.html).toContain(`/${handle}?resume=`);

    const [row] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, session.id));
    expect(row?.status).toBe("recovering");
    expect(row?.recoverySentAt).not.toBeNull();

    // A real, single-use coupon through the ordinary path — so it prices,
    // validates and expires exactly like every other one.
    const [coupon] = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.shopId, shopId), eq(coupons.code, row!.discountCode!)));
    expect(coupon?.maxRedemptions).toBe(1);
    expect(coupon?.discountType).toBe("percent");
    expect(coupon?.discountValue).toBe(1_000);
  });

  it("sends once, however many passes run", async () => {
    // Their standard: "it is one-time (we don't remind 10x)".
    await openAgo(RECOVERY_AFTER_MS + 60_000);

    const [a, b] = await Promise.all([
      runRecoveryPass(new Date(), alwaysAward),
      runRecoveryPass(new Date(), alwaysAward),
    ]);
    expect(a.sent + b.sent).toBe(1);
    expect(outbox).toHaveLength(1);

    // And a third pass, run after both, still sends nothing.
    expect((await runRecoveryPass(new Date(), alwaysAward)).sent).toBe(0);
  });

  it("does not send a minute early", async () => {
    await openAgo(RECOVERY_AFTER_MS - 60_000);
    expect((await runRecoveryPass(new Date(), alwaysAward)).sent).toBe(0);
  });

  it("never writes to a suppressed address", async () => {
    /*
     * The mail is transactional in substance and that is not a licence. A
     * `bounced` or `complained` suppression is absolute, exactly as it is for
     * a broadcast.
     */
    const session = await openAgo(RECOVERY_AFTER_MS + 60_000);
    await suppress({ shopId, email: session.email!, reason: "complained" });

    expect((await runRecoveryPass(new Date(), alwaysAward)).sent).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it("respects a product that switched recovery off", async () => {
    const productId = await makeProduct({ recoveryEnabled: false });
    await openAgo(RECOVERY_AFTER_MS + 60_000, { productId });
    expect((await runRecoveryPass(new Date(), alwaysAward)).sent).toBe(0);
  });

  it("inherits the shop when the product has never been asked", async () => {
    // `null` is inherit. Every product that existed before the column did.
    const productId = await makeProduct();
    await openAgo(RECOVERY_AFTER_MS + 60_000, { productId });
    expect((await runRecoveryPass(new Date(), alwaysAward)).sent).toBe(1);
  });

  it("exempts a membership signup, like the sweep does", async () => {
    const productId = await makeProduct({ kind: "membership" });
    await openAgo(RECOVERY_AFTER_MS + 60_000, { productId });
    expect((await runRecoveryPass(new Date(), alwaysAward)).sent).toBe(0);
  });

  it("recovers nothing from a free checkout", async () => {
    await openAgo(RECOVERY_AFTER_MS + 60_000, { subtotalCents: 0 });
    expect((await runRecoveryPass(new Date(), alwaysAward)).sent).toBe(0);
  });

  it("sends without a discount when the coin says no", async () => {
    // Which is most of the time, and is the point: award one every time and
    // buyers learn to abandon on purpose.
    const session = await openAgo(RECOVERY_AFTER_MS + 60_000);
    expect((await runRecoveryPass(new Date(), neverAward)).sent).toBe(1);

    const [row] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, session.id));
    expect(row?.discountCode).toBeNull();
    // The link is still there — it is most of the value.
    expect(outbox[0]?.html).toContain("resume=");
  });

  it("sends nothing for a shop that has recovery off", async () => {
    shopId = await makeShop({ recoveryEnabled: false });
    await openAgo(RECOVERY_AFTER_MS + 60_000);
    expect((await runRecoveryPass(new Date(), alwaysAward)).sent).toBe(0);
  });

  it("sends nothing for a shop below the plan", async () => {
    // Sessions are recorded on every plan so an upgrade has history to show;
    // only the send and the discount are gated.
    shopId = await makeShop({ plan: "free" });
    await openAgo(RECOVERY_AFTER_MS + 60_000);
    expect((await runRecoveryPass(new Date(), alwaysAward)).sent).toBe(0);
  });
});

describe("attribution", () => {
  it("is `recovered` only through the link", async () => {
    const session = await openAgo(RECOVERY_AFTER_MS + 60_000);
    await runRecoveryPass(new Date(), alwaysAward);

    const status = await markSessionPaid({
      shopId,
      sessionId: session.id,
      orderId: await makeOrderId(),
      viaResumeLink: true,
    });
    expect(status).toBe("recovered");

    const [row] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, session.id));
    expect(row?.recoveredAt).not.toBeNull();
  });

  it("is `finalized` when they came back on their own", async () => {
    /*
     * The difference between a metric and a flattering number. Without this,
     * every sale from a buyer who ever abandoned anything is a recovery.
     */
    const session = await openAgo(RECOVERY_AFTER_MS + 60_000);
    await runRecoveryPass(new Date(), alwaysAward);

    expect(
      await markSessionPaid({
        shopId,
        sessionId: session.id,
        orderId: await makeOrderId(),
        viaResumeLink: false,
      }),
    ).toBe("finalized");
  });

  it("is `finalized` for a link click on a session nobody mailed", async () => {
    // A forged `viaResumeLink` cannot manufacture a recovery: the session's
    // own status has to have been `recovering`, and only the cron sets that.
    const session = await openAgo(0);
    expect(
      await markSessionPaid({
        shopId,
        sessionId: session.id,
        orderId: await makeOrderId(),
        viaResumeLink: true,
      }),
    ).toBe("finalized");
  });
});

describe("the resume token", () => {
  it("carries no price, and dies with the session", async () => {
    const session = await openAgo(0);
    const token = resumeToken(
      { sessionId: session.id, shopId },
      new Date(Date.now() + 60_000),
    )!;
    expect(token).toBeTruthy();

    const claim = readResumeToken(token);
    expect(claim).toEqual({ sessionId: session.id, shopId });
    // Nothing about money is in the payload, so there is nothing to re-price
    // from — the server re-prices everything on arrival, which is the
    // invariant the whole checkout rests on.
    expect(JSON.stringify(claim)).not.toContain("2500");

    // Expired is refused.
    expect(
      readResumeToken(token, new Date(Date.now() + 120_000)),
    ).toBeNull();
  });

  it("refuses a token it did not sign", async () => {
    const session = await openAgo(0);
    const token = resumeToken(
      { sessionId: session.id, shopId },
      new Date(Date.now() + 60_000),
    )!;
    const [payload] = token.split(".");
    expect(readResumeToken(`${payload}.forged`)).toBeNull();
  });
});

describe("the chat-rail half", () => {
  it("does not chase a handoff the buyer completed", async () => {
    /*
     * The order was persisted before the handoff, so a buyer who *did* send
     * the WhatsApp message and paid has a settled order behind this session.
     * Writing to them would be chasing a completed sale.
     */
    const orderId = await makeOrderId("paid");
    await openAgo(RECOVERY_AFTER_MS + 60_000, { handoffOrderId: orderId });
    expect((await runRecoveryPass(new Date(), alwaysAward)).sent).toBe(0);
  });

  it("does chase one that was never sent", async () => {
    const orderId = await makeOrderId("unpaid");
    await openAgo(RECOVERY_AFTER_MS + 60_000, { handoffOrderId: orderId });
    expect((await runRecoveryPass(new Date(), alwaysAward)).sent).toBe(1);
  });
});

/** A minimal order row, for the columns attribution and the handoff read. */
async function makeOrderId(paymentStatus = "unpaid"): Promise<string> {
  const { orders } = await import("@sailo/db/schema");
  const [row] = await db
    .insert(orders)
    .values({
      shopId,
      productTitle: "A mug",
      unitPriceCents: 2_500,
      subtotalCents: 2_500,
      totalCents: 2_500,
      currency: "USD",
      paymentMethod: "whatsapp",
      paymentStatus,
    })
    .returning({ id: orders.id });
  return row!.id;
}
