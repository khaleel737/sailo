import type Stripe from "stripe";
import type * as transactional from "@sailo/email/transactional";
import type * as workflows from "@sailo/workflows/orders";
import type * as webhookEmit from "@sailo/webhooks/emit";
import { assertLocalDatabase } from "./local-only";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
/**
 * The buyer's receipt, recorded rather than sent.
 *
 * `setup.ts` deletes `RESEND_API_KEY`, so the real sender answers `{sent:false}`
 * — which is a send that did not happen, and would make "was the receipt sent
 * exactly once?" unanswerable by passing every time. Recording it is the only
 * way this file can ask the question at all.
 */
const receipts: { orderId: string; invoiceNumber: string | null }[] = [];

/** Whether the provider refuses the send. Set per test. */
let receiptFails = false;

/** Orders the seller was told about, one entry per call. */
const sellerNotices: string[] = [];

/** Outbound domain events, one entry per emit. */
const outboundWebhooks: { orderId: string; event: string }[] = [];
const webhooksFor = (orderId: string, event: string) =>
  outboundWebhooks.filter((row) => row.orderId === orderId && row.event === event);

vi.mock("@sailo/email/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof transactional>()),
  sendOrderConfirmation: async (opts: {
    order: { id: string };
    invoiceNumber: string | null;
  }) => {
    if (receiptFails) return { sent: false as const, reason: "scenario: refused" };
    receipts.push({ orderId: opts.order.id, invoiceNumber: opts.invoiceNumber });
    return { sent: true as const };
  },
}));

vi.mock("@sailo/workflows/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof workflows>()),
  notifySellerOfOrder: async (opts: { orderId: string }) => {
    sellerNotices.push(opts.orderId);
  },
}));

vi.mock("@sailo/webhooks/emit", async (importOriginal) => ({
  ...(await importOriginal<typeof webhookEmit>()),
  emitOrderWebhook: async (opts: { orderId: string; event: string }) => {
    outboundWebhooks.push({ orderId: opts.orderId, event: opts.event });
  },
}));

const { claimEvent, handleConnectEvent, releaseEvent } = await import(
  "@/lib/stripe-webhooks"
);

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

beforeEach(() => {
  receipts.length = 0;
  receiptFails = false;
  sellerNotices.length = 0;
  outboundWebhooks.length = 0;
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

  it("sends the buyer exactly one receipt, whatever Stripe delivers", async () => {
    /*
     * The invoice sequence has been guarded here since it moved onto the
     * webhook; the receipt carrying that invoice number had not been.
     *
     * `checkout.session.completed` is not the only event that settles a session
     * — `async_payment_succeeded` settles the same one, with a *different* event
     * id, so the route's event-id claim does not fence the pair. Both used to
     * find `confirmationSentAt` null under a plain read in the caller and both
     * sent, so a buyer got two receipts with two invoice links for one order and
     * no way to tell whether they had been charged twice.
     *
     * `confirmBuyerByEmail` claims the column in the UPDATE's own WHERE now, so
     * exactly one caller wins it.
     */
    const shop = await shopWithCardRail();
    const { order, sessionId } = await pendingCardOrder(shop.id);

    const completed = sessionEvent(sessionId, "paid");
    const asyncSucceeded = {
      ...sessionEvent(sessionId, "paid"),
      type: "checkout.session.async_payment_succeeded",
    } as Stripe.Event;

    /*
     * Concurrently, which is the only way this fails. Stripe delivers webhooks
     * in parallel, so the two land as two requests that both read the order
     * before either has written to it. Awaited one after the other, even the
     * check-then-act version passes — the second call reads a row the first has
     * already stamped — and the test proves nothing.
     */
    await Promise.all([
      handleConnectEvent(completed, ACCOUNT),
      handleConnectEvent(asyncSucceeded, ACCOUNT),
    ]);

    const mine = receipts.filter((row) => row.orderId === order.id);
    expect(mine).toHaveLength(1);
    // And it carries the number this settlement actually claimed.
    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.orderId, order.id),
    });
    expect(mine[0]!.invoiceNumber).toBe(invoice?.number);
    expect((await orderRow(order.id))?.confirmationSentAt).toBeInstanceOf(Date);

    /*
     * The seller's copy and the two domain events, which fired on the same
     * pre-read and now fire on the settlement claim.
     *
     * Worth being exact about what this pins and what it does not. The receipt
     * above *reproduces* the race — `confirmationSentAt` is read at the top of
     * the handler and written near the bottom, so the second delivery's read
     * lands inside that window every time. `paymentStatus` is written within a
     * few statements of being read, so the window here is narrow enough that two
     * deliveries usually miss it, and this assertion passes against the old
     * guard as often as not. It is here as the invariant, not as the repro: one
     * settled sale, one seller notice, one `order.created`, one `order.paid`.
     * A consumer that receives `order.paid` twice double-counts revenue.
     */
    expect(sellerNotices.filter((id) => id === order.id)).toHaveLength(1);
    expect(webhooksFor(order.id, "order.created")).toHaveLength(1);
    expect(webhooksFor(order.id, "order.paid")).toHaveLength(1);
  });

  it("leaves the receipt retryable when it could not be sent", async () => {
    /*
     * The other half of the claim, and the property the old stamp-afterwards
     * order was protecting. A claim held through a failed send would mean the
     * buyer has no receipt and nothing will ever try again — silently worse than
     * the double-send.
     */
    const shop = await shopWithCardRail();
    const { order, sessionId } = await pendingCardOrder(shop.id);

    receiptFails = true;
    await handleConnectEvent(sessionEvent(sessionId, "paid"), ACCOUNT);

    expect(receipts.filter((row) => row.orderId === order.id)).toHaveLength(0);
    expect((await orderRow(order.id))?.confirmationSentAt).toBeNull();
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
