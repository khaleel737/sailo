import type Stripe from "stripe";
import { assertLocalDatabase } from "./local-only";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  invoices,
  orderItems,
  orders,
  paymentMethods,
  productFiles,
  products,
  shops,
  stripeEvents,
  user,
} from "@sailo/db/schema";
import { claimEvent, handleConnectEvent, releaseEvent } from "@/lib/stripe-webhooks";

/**
 * Settlement — what happens when the money actually arrives.
 *
 * This is the half of the card path no test has ever touched. The checkout
 * e2e suite opens the panel and asserts it renders; the scenario suite places
 * orders on manual rails, where the order *is* the commitment and no webhook
 * is coming. Everything between "the buyer was sent to Stripe" and "the seller
 * has a paid order with an invoice and the buyer has their files" was carried
 * by unit tests of pure rules and by reading.
 *
 * That gap is where the expensive bugs lived. Every one of these assertions
 * corresponds to a defect that shipped: an invoice number claimed before the
 * buyer paid and gapping a sequence a tax authority expects unbroken; a
 * confirmation email sent for an order the sweep would cancel; a 100%-off
 * coupon stranded in `pending` forever because `no_payment_required` was read
 * as money still in flight; a refund from one connected account marking
 * another shop's order refunded.
 *
 * No Stripe API call and no connected account: the events are constructed and
 * handed to the same `handleConnectEvent` the route calls, against real rows
 * in a database this is allowed to dirty. What that does not cover is Stripe
 * actually producing these shapes — for that, `stripe listen` and a card in
 * the test-mode checkout is still the only proof.
 */

const db = getDb();
const uid = () => crypto.randomUUID();
const ACCOUNT = "acct_scenario_seller";

beforeAll(() => {
  assertLocalDatabase();
});

async function shopWithCardRail() {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `settle-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `settle-${userId.slice(0, 8)}`,
      name: "Settling Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      stripeAccountId: ACCOUNT,
      stripeChargesEnabled: true,
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

/**
 * An order in the state `createOrderIntent` leaves a card checkout in: written,
 * stock taken, session id recorded, and waiting for money that has not arrived.
 */
async function pendingCardOrder(
  shopId: string,
  over: Partial<typeof orders.$inferInsert> = {},
) {
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
      ...over,
    })
    .returning();
  if (!order) throw new Error("fixture: order was not inserted");

  await db.insert(orderItems).values({
    orderId: order.id,
    title: "Speckled Mug",
    kind: over.downloadToken ? "digital" : "physical",
    unitPriceCents: 2400,
    quantity: 1,
    subtotalCents: 2400,
    position: 0,
  });
  return { order, sessionId };
}

function sessionEvent(
  sessionId: string,
  paymentStatus: Stripe.Checkout.Session.PaymentStatus,
  extra: Partial<Stripe.Checkout.Session> = {},
): Stripe.Event {
  return {
    id: `evt_${uid().replace(/-/g, "")}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: paymentStatus,
        payment_intent: `pi_${uid().replace(/-/g, "")}`,
        metadata: {},
        ...extra,
      } as Stripe.Checkout.Session,
    },
  } as Stripe.Event;
}

const orderRow = (id: string) => db.query.orders.findFirst({ where: eq(orders.id, id) });

describe("a card payment settles", () => {
  it("marks the order paid and confirms it", async () => {
    const shop = await shopWithCardRail();
    const { order, sessionId } = await pendingCardOrder(shop.id);

    const result = await handleConnectEvent(sessionEvent(sessionId, "paid"), ACCOUNT);
    expect(result).toContain("paid");

    const settled = await orderRow(order.id);
    expect(settled?.paymentStatus).toBe("paid");
    // Payment is what confirms an order, so the seller never has to.
    expect(settled?.status).toBe("confirmed");
    expect(settled?.stripePaymentIntentId).toBeTruthy();
  });

  it("issues the invoice here, not at checkout", async () => {
    /*
     * The whole reason invoicing moved onto this webhook. Claiming a number
     * when the buyer was merely sent to Stripe left a hole in the sequence
     * every time somebody abandoned the payment.
     */
    const shop = await shopWithCardRail();
    const { order, sessionId } = await pendingCardOrder(shop.id);

    const before = await db.query.invoices.findFirst({
      where: eq(invoices.orderId, order.id),
    });
    expect(before, "an unpaid order must not hold an invoice number").toBeUndefined();

    await handleConnectEvent(sessionEvent(sessionId, "paid"), ACCOUNT);

    const after = await db.query.invoices.findFirst({
      where: eq(invoices.orderId, order.id),
    });
    expect(after?.number).toBeTruthy();
  });

  it("claims one invoice number however many times Stripe delivers", async () => {
    // Stripe retries until it gets a 2xx and will re-deliver on its own.
    const shop = await shopWithCardRail();
    const { order, sessionId } = await pendingCardOrder(shop.id);

    await handleConnectEvent(sessionEvent(sessionId, "paid"), ACCOUNT);
    await handleConnectEvent(sessionEvent(sessionId, "paid"), ACCOUNT);

    const all = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
    expect(all).toHaveLength(1);
  });

  it("releases a digital order's files", async () => {
    const shop = await shopWithCardRail();
    const [product] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Guide",
        slug: `g-${uid().slice(0, 8)}`,
        kind: "digital",
        priceCents: 2400,
        isPublished: true,
      })
      .returning();
    if (!product) throw new Error("fixture: product was not inserted");
    await db.insert(productFiles).values({
      productId: product.id,
      name: "guide.pdf",
      url: "https://store1.public.blob.vercel-storage.com/guide.pdf",
      sizeBytes: 1024,
      contentType: "application/pdf",
      position: 0,
    });

    const { order, sessionId } = await pendingCardOrder(shop.id, {
      productId: product.id,
      productKind: "digital",
      downloadToken: uid().replace(/-/g, ""),
    });
    await db
      .update(orderItems)
      .set({ productId: product.id, kind: "digital" })
      .where(eq(orderItems.orderId, order.id));

    await handleConnectEvent(sessionEvent(sessionId, "paid"), ACCOUNT);

    const settled = await orderRow(order.id);
    expect(
      settled?.downloadReleasedAt,
      "a paid digital order must unlock its files",
    ).toBeTruthy();
  });

  it("treats a 100%-off checkout as settled, not as money in flight", async () => {
    /*
     * `no_payment_required` is what Stripe reports when a coupon takes the
     * total to zero. Reading every non-`paid` status as "still settling" left
     * those orders in `pending` forever: no `async_payment_*` event ever
     * follows, because nothing is settling — and the sweep skips `pending`, so
     * the stock was never reclaimed either.
     */
    const shop = await shopWithCardRail();
    const { order, sessionId } = await pendingCardOrder(shop.id, { totalCents: 0 });

    await handleConnectEvent(sessionEvent(sessionId, "no_payment_required"), ACCOUNT);

    const settled = await orderRow(order.id);
    expect(settled?.paymentStatus).toBe("paid");
  });

  it("holds a delayed payment as pending rather than letting the sweep cancel it", async () => {
    // Boleto takes up to three days, SEPA longer. `unpaid` is the shape the
    // sweep reclaims at 24 hours, which cancelled real buyers mid-payment.
    const shop = await shopWithCardRail();
    const { order, sessionId } = await pendingCardOrder(shop.id);

    await handleConnectEvent(sessionEvent(sessionId, "unpaid"), ACCOUNT);

    const settled = await orderRow(order.id);
    expect(settled?.paymentStatus).toBe("pending");
  });

  it("leaves a booking for the seller to accept, even once paid", async () => {
    // The checkout promises the shop confirms the slot afterwards; flipping it
    // to `confirmed` here made that a lie.
    const shop = await shopWithCardRail();
    const when = new Date(Date.now() + 3 * 86_400_000);
    const { order, sessionId } = await pendingCardOrder(shop.id, { scheduledFor: when });

    await handleConnectEvent(sessionEvent(sessionId, "paid"), ACCOUNT);

    const settled = await orderRow(order.id);
    expect(settled?.paymentStatus).toBe("paid");
    expect(settled?.status).toBe("new");
  });
});

describe("settlement is scoped to the account that sent it", () => {
  it("ignores an event from another seller's connected account", async () => {
    /*
     * A connected account is controlled by a seller, and a seller is not a
     * trusted party. This is the property that stops one shop settling — or
     * refunding, or clearing a chargeback on — another shop's order.
     */
    const shop = await shopWithCardRail();
    const { order } = await pendingCardOrder(shop.id);

    // Looked up by order id rather than session id, which is the path that
    // goes through `ownedBySender`. A session id is minted by Stripe and
    // globally unique, so it cannot be guessed by a hostile account.
    const event = sessionEvent(`cs_test_${uid().replace(/-/g, "")}`, "paid", {
      metadata: { orderId: order.id },
    });

    const result = await handleConnectEvent(event, "acct_someone_else");
    expect(result).toBe("order not found");

    const untouched = await orderRow(order.id);
    expect(untouched?.paymentStatus).toBe("unpaid");
  });
});

describe("an event delivered twice is handled once", () => {
  it("claims an event id and refuses the redelivery", async () => {
    const id = `evt_${uid().replace(/-/g, "")}`;
    const event = { id, type: "checkout.session.completed" } as Stripe.Event;

    expect(await claimEvent(event)).toBe(true);
    expect(await claimEvent(event), "a redelivery must not be handled again").toBe(false);

    const rows = await db.select().from(stripeEvents).where(eq(stripeEvents.id, id));
    expect(rows).toHaveLength(1);
  });

  it("gives the claim back when a handler throws, so Stripe's retry can work", async () => {
    const id = `evt_${uid().replace(/-/g, "")}`;
    const event = { id, type: "checkout.session.completed" } as Stripe.Event;

    expect(await claimEvent(event)).toBe(true);
    await releaseEvent(id);
    expect(await claimEvent(event)).toBe(true);
  });
});
