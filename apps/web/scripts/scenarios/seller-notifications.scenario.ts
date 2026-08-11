import type Stripe from "stripe";
import type * as nextServer from "next/server";
import type * as transport from "@/lib/email/transport";
import { assertLocalDatabase } from "./local-only";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * The seller's own email, and the one rule it has to obey: **exactly one per
 * order.**
 *
 * There are two places an order settles, and both of them already send the
 * buyer's confirmation — so the seller's copy is one `if` away from firing
 * twice on the card rail and once everywhere else. That bug is invisible in
 * production until a seller complains about duplicates, and invisible in
 * tests unless something counts the sends.
 *
 * So this suite counts them. `transport.send` is stubbed at the module
 * boundary — the same seam `email/preview.test.ts` uses — which is the only
 * way to observe a send at all: `setup.ts` deletes `RESEND_API_KEY`, so the
 * real `send` returns `{ sent: false }` and every path "succeeds" without
 * proving anything.
 */

/** Every message the app tried to send, in order. */
const sent: { to: string; subject: string }[] = [];

/**
 * The work `after()` deferred, held so a test can wait for it.
 *
 * `setup.ts` already runs `after` callbacks inline, which is what makes them
 * observable at all — but it discards the promise, and a seller notification
 * is four database round trips behind the response. Asserting straight after
 * the action therefore raced it, and the suite reported "no email sent" for
 * an email that was still being composed. Keeping the promises lets each test
 * say when it is willing to look.
 */
const deferred: Promise<unknown>[] = [];

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof nextServer>()),
  after: (fn: (() => unknown) | Promise<unknown>) => {
    deferred.push(Promise.resolve(typeof fn === "function" ? fn() : fn));
  },
}));

/** Waits for everything `after()` has queued, including anything it queued. */
async function flushAfter() {
  while (deferred.length > 0) {
    await Promise.allSettled(deferred.splice(0, deferred.length));
  }
}

vi.mock("@/lib/email/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof transport>();
  return {
    ...actual,
    send: async (opts: { to: string; subject: string }) => {
      sent.push({ to: opts.to, subject: opts.subject });
      return { sent: true, id: `stub_${sent.length}` };
    },
  };
});

const { getDb } = await import("@/db");
const { orderItems, orders, paymentMethods, products, shops, user } = await import(
  "@/db/schema"
);
const { createOrderIntent } = await import("@/lib/actions/orders");
const { submitPaymentReference } = await import("@/lib/actions/payment-reference");
const { claimEvent, handleConnectEvent } = await import("@/lib/stripe-webhooks");
const { notifySellerOfOrder } = await import("@/lib/orders/notify-seller");

const db = getDb();
const uid = () => crypto.randomUUID();
const ACCOUNT = "acct_notify_seller";

/** Only the mail addressed to the seller — the buyer's copy rides the same stub. */
const toSeller = (email: string) => sent.filter((m) => m.to === email);

beforeAll(() => {
  assertLocalDatabase();
});

beforeEach(() => {
  sent.length = 0;
  deferred.length = 0;
});

async function makeShop(over: Partial<typeof shops.$inferInsert> = {}) {
  const userId = uid();
  const email = `notify-${userId.slice(0, 8)}@example.com`;

  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `notify-${userId.slice(0, 8)}`,
      name: "Notified Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");

  return { shop, sellerEmail: shop.contactEmail ?? email };
}

async function withRail(shopId: string, type: "cod" | "card" | "bank_transfer") {
  await db.insert(paymentMethods).values({
    shopId,
    type,
    label: type,
    config:
      type === "bank_transfer"
        ? ({
            bankName: "Test Bank",
            // The only field the rail actually requires.
            accountName: "Notified Shop Ltd",
            accountNumber: "12345678",
          } as never)
        : ({} as never),
    isEnabled: true,
    position: 0,
  });
}

async function makeProduct(shopId: string, over: Partial<typeof products.$inferInsert> = {}) {
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
      ...over,
    })
    .returning();
  if (!product) throw new Error("fixture: product was not inserted");
  return product;
}

function sessionEvent(sessionId: string): Stripe.Event {
  return {
    id: `evt_${uid().replace(/-/g, "")}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: `pi_${uid().replace(/-/g, "")}`,
        metadata: {},
      } as Stripe.Checkout.Session,
    },
  } as Stripe.Event;
}

describe("a manual order emails the seller at checkout", () => {
  it("sends one email, to the seller, naming the amount", async () => {
    const { shop, sellerEmail } = await makeShop();
    await withRail(shop.id, "cod");
    const product = await makeProduct(shop.id);

    const result = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "cod",
      customerName: "Buyer",
      customerEmail: "buyer@example.com",
      customerPhone: "+15550100",
    });
    expect(result.ok).toBe(true);
    await flushAfter();

    const mail = toSeller(sellerEmail);
    expect(mail).toHaveLength(1);
    expect(mail[0]?.subject).toContain("New order");
    expect(mail[0]?.subject).toContain("$24");
  });

  it("goes to the shop's contact address when one is set", async () => {
    // The account email is where a seller signs in; the contact address is
    // where they said to reach them about the shop.
    const { shop } = await makeShop({ contactEmail: "shop@example.com" });
    await withRail(shop.id, "cod");
    const product = await makeProduct(shop.id);

    await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "cod",
      customerName: "Buyer",
      customerPhone: "+15550100",
    });
    await flushAfter();

    expect(toSeller("shop@example.com")).toHaveLength(1);
  });

  it("sends the booking mail instead when the order carries a slot", async () => {
    /*
     * One email per order, not two. A booked order is still an order, so the
     * naive version sends both — and the seller's next move on a booking is
     * accept-or-decline rather than fulfil, so the booking mail is the one
     * that carries the right instruction.
     *
     * The order row is written directly rather than booked through checkout:
     * what is under test is which of the two mails the discriminator picks,
     * and going through `createOrderIntent` would drag in the whole
     * availability stack — opening hours, slot spacing, the claim index —
     * none of which this branch depends on. `booking.scenario.ts` is where
     * the path that *produces* `scheduledFor` is proved.
     */
    const { shop, sellerEmail } = await makeShop({ timeZone: "UTC" });
    const service = await makeProduct(shop.id, {
      kind: "service",
      durationMinutes: 60,
      serviceMode: "in_person",
    });

    const slot = new Date(Date.now() + 7 * 86_400_000);
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        productId: service.id,
        productTitle: service.title,
        productKind: "service",
        quantity: 1,
        subtotalCents: 2400,
        totalCents: 2400,
        customerName: "Buyer",
        customerEmail: "buyer@example.com",
        paymentMethod: "cod",
        paymentStatus: "unpaid",
        status: "new",
        scheduledFor: slot,
      })
      .returning();
    if (!order) throw new Error("fixture: order was not inserted");

    await notifySellerOfOrder({ shop, orderId: order.id });

    const mail = toSeller(sellerEmail);
    expect(mail).toHaveLength(1);
    expect(mail[0]?.subject).toContain("Booking request");
    expect(mail[0]?.subject).not.toContain("New order");
  });
});

describe("a switched-off preference is honoured", () => {
  it("sends nothing when orderPlaced is off", async () => {
    const { shop, sellerEmail } = await makeShop({
      notificationPrefs: { orderPlaced: false },
    });
    await withRail(shop.id, "cod");
    const product = await makeProduct(shop.id);

    const result = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "cod",
      customerName: "Buyer",
      customerEmail: "buyer@example.com",
      customerPhone: "+15550100",
    });
    expect(result.ok).toBe(true);
    await flushAfter();

    expect(toSeller(sellerEmail)).toHaveLength(0);
    // The buyer still gets theirs — the switch is the seller's alone.
    expect(sent.some((m) => m.to === "buyer@example.com")).toBe(true);
  });

  it("still sends when a different switch is off", async () => {
    // Absence means on, and one `false` must not silence the others.
    const { shop, sellerEmail } = await makeShop({
      notificationPrefs: { orderNeedsAction: false },
    });
    await withRail(shop.id, "cod");
    const product = await makeProduct(shop.id);

    await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "cod",
      customerName: "Buyer",
      customerPhone: "+15550100",
    });
    await flushAfter();

    expect(toSeller(sellerEmail)).toHaveLength(1);
  });
});

describe("the card rail sends on settlement, exactly once", () => {
  async function pendingCardOrder(shopId: string) {
    const sessionId = `cs_test_${uid().replace(/-/g, "")}`;
    const [order] = await db
      .insert(orders)
      .values({
        shopId,
        productTitle: "Speckled Mug",
        quantity: 1,
        subtotalCents: 2400,
        totalCents: 2400,
        customerName: "Buyer",
        customerEmail: "buyer@example.com",
        paymentMethod: "card",
        paymentStatus: "unpaid",
        status: "new",
        stripeSessionId: sessionId,
        stripeAccountId: ACCOUNT,
      })
      .returning();
    if (!order) throw new Error("fixture: order was not inserted");

    await db.insert(orderItems).values({
      orderId: order.id,
      title: "Speckled Mug",
      kind: "physical",
      unitPriceCents: 2400,
      quantity: 1,
      subtotalCents: 2400,
      position: 0,
    });
    return { order, sessionId };
  }

  it("emails on the webhook, not when the checkout was created", async () => {
    const { shop, sellerEmail } = await makeShop({
      stripeAccountId: ACCOUNT,
      stripeChargesEnabled: true,
    });
    const { sessionId } = await pendingCardOrder(shop.id);

    // The order exists and the buyer is at Stripe — nothing has settled.
    expect(toSeller(sellerEmail)).toHaveLength(0);

    await handleConnectEvent(sessionEvent(sessionId), ACCOUNT);
    expect(toSeller(sellerEmail)).toHaveLength(1);
  });

  it("sends once when the same event is delivered twice", async () => {
    /*
     * Stripe delivers at least once. The event-id claim is what makes a
     * redelivery a no-op, and the seller's mail has to hang off the claimed
     * path exactly like the buyer's — otherwise a retry mails twice about one
     * sale.
     */
    const { shop, sellerEmail } = await makeShop({
      stripeAccountId: ACCOUNT,
      stripeChargesEnabled: true,
    });
    const { sessionId } = await pendingCardOrder(shop.id);
    const event = sessionEvent(sessionId);

    expect(await claimEvent(event)).toBe(true);
    await handleConnectEvent(event, ACCOUNT);

    // The route skips the handler entirely on a replay; this is that check.
    expect(await claimEvent(event)).toBe(false);

    expect(toSeller(sellerEmail)).toHaveLength(1);
  });

  it("sends once when a second settling event arrives for a paid order", async () => {
    /*
     * A different hole from the replay above: `checkout.session.completed`
     * followed by `async_payment_succeeded` are two distinct event ids for
     * one order, so the idempotency claim lets both through. The pre-update
     * payment status is what stops the second email.
     */
    const { shop, sellerEmail } = await makeShop({
      stripeAccountId: ACCOUNT,
      stripeChargesEnabled: true,
    });
    const { sessionId } = await pendingCardOrder(shop.id);

    await handleConnectEvent(sessionEvent(sessionId), ACCOUNT);
    await handleConnectEvent(sessionEvent(sessionId), ACCOUNT);

    expect(toSeller(sellerEmail)).toHaveLength(1);
  });
});

describe("a reported bank transfer asks the seller to confirm it", () => {
  it("emails once the reference is recorded", async () => {
    const { shop, sellerEmail } = await makeShop();
    await withRail(shop.id, "bank_transfer");
    const product = await makeProduct(shop.id);

    const result = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "bank_transfer",
      customerName: "Buyer",
      customerEmail: "buyer@example.com",
      customerPhone: "+15550100",
    });
    if (!result.ok) throw new Error(result.error);
    await flushAfter();
    sent.length = 0; // The order mail already went; this is about the next one.

    const reported = await submitPaymentReference({
      orderId: result.orderId,
      reference: "REF-12345",
    });
    expect(reported.ok).toBe(true);
    await flushAfter();

    const mail = toSeller(sellerEmail);
    expect(mail).toHaveLength(1);
    expect(mail[0]?.subject).toContain("Payment reported");

    const row = await db.query.orders.findFirst({ where: eq(orders.id, result.orderId) });
    expect(row?.paymentStatus).toBe("pending");
  });

  it("stays quiet when orderNeedsAction is off", async () => {
    const { shop, sellerEmail } = await makeShop({
      notificationPrefs: { orderNeedsAction: false },
    });
    await withRail(shop.id, "bank_transfer");
    const product = await makeProduct(shop.id);

    const result = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "bank_transfer",
      customerName: "Buyer",
      customerPhone: "+15550100",
    });
    if (!result.ok) throw new Error(result.error);
    await flushAfter();
    sent.length = 0;

    await submitPaymentReference({ orderId: result.orderId, reference: "REF-999" });
    await flushAfter();
    expect(toSeller(sellerEmail)).toHaveLength(0);
  });
});
