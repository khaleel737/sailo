import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  disputes,
  earlyFraudWarnings,
  orderItems,
  orders,
  paymentMethods,
  shops,
  user,
} from "@sailo/db/schema";

/**
 * Telling a seller their money is being taken back.
 *
 * The subject here is not the wording — that is a builder returning a string and
 * a preview test already renders it. It is the *decision*: who gets told, once,
 * about what, and whether a webhook Stripe delivers three times produces one
 * email or three.
 *
 * Which is why almost every test below is about the claim. Sending twice is the
 * failure that makes a seller filter the alerts, and the alerts are the only
 * reason the rest of the chargeback pipeline is reachable by the person who
 * holds the evidence.
 */

/** Every message that reached the mail transport, in order. */
const mail: { kind: string; to: string; subject: string }[] = [];
/** Every push that reached Expo. */
const pushes: { kind: string; title: string }[] = [];

let mailSucceeds = true;

vi.mock("@sailo/email/shop", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const record = (kind: string) => async (opts: { to: string }) => {
    if (!mailSucceeds) return { sent: false as const, reason: "resend is down" };
    mail.push({ kind, to: opts.to, subject: kind });
    return { sent: true as const };
  };
  return {
    ...actual,
    sendSellerDisputeOpened: record("opened"),
    sendSellerDisputeDeadline: record("deadline"),
    sendSellerDisputeClosed: record("closed"),
    sendSellerFraudWarning: record("fraud_warning"),
  };
});

vi.mock("@sailo/notifications/push", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  pushSellerDispute: async (opts: { kind: string }) => {
    pushes.push({ kind: opts.kind, title: opts.kind });
  },
}));

const {
  notifySellerDisputeClosed,
  notifySellerDisputeOpened,
  notifySellerFraudWarning,
  sendDueDisputeReminders,
} = await import("@sailo/workflows/disputes");

const db = getDb();
const uid = () => crypto.randomUUID();
const ACCOUNT = "acct_notice_seller";

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures(["dnotice-"]);
});

beforeEach(() => {
  mail.length = 0;
  pushes.length = 0;
  mailSucceeds = true;
});

async function fixture(
  over: {
    dueInDays?: number | null;
    status?: string;
    shipped?: boolean;
    contactEmail?: string | null;
  } = {},
) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `dnotice-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  /*
   * One live holder per connected account — the uniqueness 0064 gives
   * production holds in scenarios too. Earlier tests' fixture shops release
   * the account the way a real reconnect would.
   */
  await db
    .update(shops)
    .set({ stripeAccountId: null })
    .where(eq(shops.stripeAccountId, ACCOUNT));
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `dnotice-${userId.slice(0, 8)}`,
      name: "Parcel Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      stripeAccountId: ACCOUNT,
      stripeChargesEnabled: true,
      ...(over.contactEmail === undefined ? {} : { contactEmail: over.contactEmail }),
    })
    .returning();
  if (!shop) throw new Error("fixture: no shop");

  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type: "card",
    label: "card",
    config: {} as never,
    isEnabled: true,
    position: 0,
  });

  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
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
      termsAcceptedAt: new Date(),
      paymentMethod: "card",
      paymentStatus: "disputed",
      status: "confirmed",
      stripePaymentIntentId: `pi_${uid().replace(/-/g, "")}`,
      stripeAccountId: ACCOUNT,
      ...(over.shipped
        ? {
            trackingCarrier: "Royal Mail",
            trackingNumber: "RM123456789GB",
            shippedAt: new Date(Date.now() - 5 * 86_400_000),
          }
        : {}),
    })
    .returning();
  if (!order) throw new Error("fixture: no order");

  await db.insert(orderItems).values({
    orderId: order.id,
    title: "Speckled Mug",
    kind: "physical",
    unitPriceCents: 4200,
    quantity: 1,
    subtotalCents: 4200,
    position: 0,
  });

  const days = over.dueInDays === undefined ? 18 : over.dueInDays;
  const [dispute] = await db
    .insert(disputes)
    .values({
      scope: "connected",
      shopId: shop.id,
      orderId: order.id,
      stripeDisputeId: `du_${uid().replace(/-/g, "")}`,
      stripeChargeId: `ch_${uid().replace(/-/g, "")}`,
      stripeAccountId: ACCOUNT,
      amountCents: 4200,
      feeCents: 1500,
      deductedCents: 5700,
      currency: "USD",
      reason: "product_not_received",
      status: over.status ?? "needs_response",
      dueBy: days === null ? null : new Date(Date.now() + days * 86_400_000),
      stripeCreatedAt: new Date(),
    })
    .returning();
  if (!dispute) throw new Error("fixture: no dispute");

  return { shop, order, dispute };
}

const reload = async (id: string) =>
  db.query.disputes.findFirst({ where: eq(disputes.id, id) });

describe("when a chargeback arrives", () => {
  it("emails the seller and pushes to their phone", async () => {
    const { dispute } = await fixture();
    await notifySellerDisputeOpened(dispute);

    expect(mail.map((m) => m.kind)).toEqual(["opened"]);
    expect(pushes.map((p) => p.kind)).toEqual(["chargeback"]);
    expect((await reload(dispute.id))?.sellerOpenedNotifiedAt).not.toBeNull();
  });

  it("prefers the shop's contact address over the account's", async () => {
    /*
     * A seller who set a contact address did so because that is the inbox
     * somebody watches. Sending the most urgent mail in the product to the
     * signup address instead is how it goes unread.
     */
    const { dispute } = await fixture({ contactEmail: "shop@example.com" });
    await notifySellerDisputeOpened(dispute);
    expect(mail[0]?.to).toBe("shop@example.com");
  });

  it("sends once, however many times Stripe delivers the event", async () => {
    /*
     * The defect this whole claim mechanism exists for. Stripe delivers at least
     * once, and one dispute legitimately arrives under several event ids —
     * `created`, then `updated` carrying the CE3.0 eligibility, then more. A
     * read-then-send mails the seller every time.
     */
    const { dispute } = await fixture();

    await notifySellerDisputeOpened(dispute);
    await notifySellerDisputeOpened(dispute);
    await notifySellerDisputeOpened(dispute);

    expect(mail).toHaveLength(1);
  });

  it("sends once when two deliveries race", async () => {
    /*
     * The same thing, concurrently, which is what actually happens: Stripe's
     * retry can overlap the original. The claim is a single conditional update,
     * so Postgres decides — a check-then-write would let both callers see null.
     */
    const { dispute } = await fixture();

    await Promise.all([
      notifySellerDisputeOpened(dispute),
      notifySellerDisputeOpened(dispute),
      notifySellerDisputeOpened(dispute),
    ]);

    expect(mail).toHaveLength(1);
  });

  it("lets the next attempt try again when the mail provider fails", async () => {
    /*
     * A claim taken and not used would silence the only warning a seller gets,
     * permanently, because a provider was down for a minute. The claim is
     * released on failure so Stripe's own retry — or the next event on the
     * dispute — can send it.
     */
    const { dispute } = await fixture();
    mailSucceeds = false;

    await notifySellerDisputeOpened(dispute);
    expect(mail).toHaveLength(0);
    expect((await reload(dispute.id))?.sellerOpenedNotifiedAt).toBeNull();

    mailSucceeds = true;
    await notifySellerDisputeOpened(dispute);
    expect(mail).toHaveLength(1);
  });

  it("says nothing to a seller about their own subscription chargeback", async () => {
    /*
     * A platform dispute is the seller charging back their Sailo invoice. They
     * know: they started it. Mailing them "a buyer disputed a payment" about
     * their own action is both wrong and confusing.
     */
    const { dispute } = await fixture();
    await db
      .update(disputes)
      .set({ scope: "platform" })
      .where(eq(disputes.id, dispute.id));

    const row = await reload(dispute.id);
    await notifySellerDisputeOpened(row!);
    expect(mail).toHaveLength(0);
  });
});

describe("when it closes", () => {
  it("tells the seller the outcome, once", async () => {
    const { dispute } = await fixture({ status: "won" });
    const row = await reload(dispute.id);

    await notifySellerDisputeClosed(row!);
    await notifySellerDisputeClosed(row!);

    expect(mail.map((m) => m.kind)).toEqual(["closed"]);
  });

  it("is a separate claim from the opening mail", async () => {
    /*
     * Three columns, not one flag. A seller who was told the chargeback arrived
     * is still owed the result — and on a win, being told the money came back is
     * what stops them reconciling a hole that is not there.
     */
    const { dispute } = await fixture();
    await notifySellerDisputeOpened(dispute);

    await db.update(disputes).set({ status: "won" }).where(eq(disputes.id, dispute.id));
    await notifySellerDisputeClosed((await reload(dispute.id))!);

    expect(mail.map((m) => m.kind)).toEqual(["opened", "closed"]);
  });
});

describe("the deadline reminder", () => {
  it("nudges a case whose deadline is close and still unanswered", async () => {
    const { dispute } = await fixture({ dueInDays: 3 });

    const result = await sendDueDisputeReminders();

    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(mail.some((m) => m.kind === "deadline")).toBe(true);
    expect((await reload(dispute.id))?.sellerDeadlineNotifiedAt).not.toBeNull();
  });

  it("leaves a case with weeks left alone", async () => {
    const { dispute } = await fixture({ dueInDays: 18 });
    await sendDueDisputeReminders();
    expect((await reload(dispute.id))?.sellerDeadlineNotifiedAt).toBeNull();
  });

  it("nags exactly once, however often the sweep runs", async () => {
    /*
     * Hourly cron, four-day window: without the claim a seller gets ninety-six
     * identical emails about one chargeback, which is worse than none.
     */
    const { dispute } = await fixture({ dueInDays: 2 });

    await sendDueDisputeReminders();
    await sendDueDisputeReminders();
    await sendDueDisputeReminders();

    expect(mail.filter((m) => m.kind === "deadline")).toHaveLength(1);
    expect((await reload(dispute.id))?.sellerDeadlineNotifiedAt).not.toBeNull();
  });

  it("says nothing about a case that has already been answered", async () => {
    /*
     * Evidence sent means there is nothing left to do, and a reminder would send
     * the seller looking for a document the platform has already submitted.
     */
    const { dispute } = await fixture({ dueInDays: 2 });
    await db
      .update(disputes)
      .set({ evidenceSubmittedAt: new Date() })
      .where(eq(disputes.id, dispute.id));

    await sendDueDisputeReminders();
    expect((await reload(dispute.id))?.sellerDeadlineNotifiedAt).toBeNull();
  });

  it("says nothing about a deadline that has already passed", async () => {
    /*
     * A notification with no action attached. The window is closed server-side
     * and the payments page already says so — telling somebody by email that
     * they have missed something irrecoverable is noise with a cost.
     */
    const { dispute } = await fixture({ dueInDays: -2 });
    await sendDueDisputeReminders();
    expect((await reload(dispute.id))?.sellerDeadlineNotifiedAt).toBeNull();
  });

  it("says nothing about a case that is already decided", async () => {
    const { dispute } = await fixture({ dueInDays: 2, status: "lost" });
    await sendDueDisputeReminders();
    expect((await reload(dispute.id))?.sellerDeadlineNotifiedAt).toBeNull();
  });
});

describe("an early fraud warning", () => {
  async function warning(shopId: string, orderId: string) {
    const [row] = await db
      .insert(earlyFraudWarnings)
      .values({
        shopId,
        orderId,
        stripeWarningId: `issfr_${uid().replace(/-/g, "")}`,
        stripeChargeId: `ch_${uid().replace(/-/g, "")}`,
        stripeAccountId: ACCOUNT,
        fraudType: "made_with_stolen_card",
        stripeCreatedAt: new Date(),
      })
      .returning();
    return row!;
  }

  it("tells the seller while refunding still avoids the chargeback", async () => {
    const { shop, order } = await fixture();
    const row = await warning(shop.id, order.id);

    await notifySellerFraudWarning({
      id: row.id,
      shopId: shop.id,
      orderId: order.id,
      fraudType: row.fraudType,
    });

    expect(mail.map((m) => m.kind)).toEqual(["fraud_warning"]);
    expect(pushes.map((p) => p.kind)).toEqual(["fraud_warning"]);
  });

  it("sends once", async () => {
    const { shop, order } = await fixture();
    const row = await warning(shop.id, order.id);
    const args = {
      id: row.id,
      shopId: shop.id,
      orderId: order.id,
      fraudType: row.fraudType,
    };

    await notifySellerFraudWarning(args);
    await notifySellerFraudWarning(args);

    expect(mail).toHaveLength(1);
    const [reloaded] = await db
      .select()
      .from(earlyFraudWarnings)
      .where(eq(earlyFraudWarnings.id, row.id));
    expect(reloaded?.sellerNotifiedAt).not.toBeNull();
  });

  it("lets a failed send be retried", async () => {
    const { shop, order } = await fixture();
    const row = await warning(shop.id, order.id);
    const args = {
      id: row.id,
      shopId: shop.id,
      orderId: order.id,
      fraudType: row.fraudType,
    };

    mailSucceeds = false;
    await notifySellerFraudWarning(args);
    expect(mail).toHaveLength(0);

    mailSucceeds = true;
    await notifySellerFraudWarning(args);
    expect(mail).toHaveLength(1);
  });
});
