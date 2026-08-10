import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  orders,
  paymentMethods,
  productFiles,
  products,
  shops,
  tickets,
  user,
} from "@/db/schema";
import { createOrderIntent } from "@/lib/actions/orders";
import { releaseDownloads } from "@/lib/downloads";
import { checkInTicketForShop } from "@/lib/tickets";

/**
 * Event tickets, end to end: minted with the order, gated by the release
 * timestamp, admitted exactly once — including the two-phones race the
 * check-in screen exists to survive.
 */

const db = getDb();
const uid = () => crypto.randomUUID();

const buyer = {
  customerName: "Buyer",
  customerEmail: "buyer@example.com",
  customerPhone: "+15551234567",
  addressLine1: "1 High Street",
  city: "Leeds",
  postalCode: "LS1 1AA",
  country: "UK",
};

const inAWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);
const lastWeek = () => new Date(Date.now() - 7 * 24 * 3600 * 1000);

async function makeShop() {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `seller-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `shop-${userId.slice(0, 8)}`,
      name: "Ticket Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type: "cod",
    label: "cod",
    config: {} as never,
    isEnabled: true,
    position: 0,
  });
  return shop;
}

async function makeEvent(
  shopId: string,
  over: Partial<typeof products.$inferInsert> = {},
) {
  const [p] = await db
    .insert(products)
    .values({
      shopId,
      title: "Rooftop Show",
      slug: `ev-${uid().slice(0, 8)}`,
      kind: "event",
      priceCents: 2500,
      eventStartsAt: inAWeek(),
      releaseOnPayment: true,
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!p) throw new Error("fixture: event was not inserted");
  return p;
}

const orderRow = (id: string) =>
  db.query.orders.findFirst({ where: eq(orders.id, id) });
const ticketRows = (orderId: string) =>
  db.query.tickets.findMany({ where: eq(tickets.orderId, orderId) });

async function placedOrder(shopId: string, productId: string, quantity = 1) {
  const r = await createOrderIntent({
    shopId,
    items: [{ productId, quantity }],
    paymentMethod: "cod",
    ...buyer,
  });
  if (!r.ok) throw new Error(`order refused: ${r.error}`);
  return r.orderId;
}

beforeAll(async () => {
  assertLocalDatabase();
});

describe("tickets are minted with the order", () => {
  it("fans quantity out to one row per admission, held until payment", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);
    const orderId = await placedOrder(shop.id, ev.id, 3);

    const rows = await ticketRows(orderId);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((t) => t.code)).size).toBe(3);
    expect(rows.every((t) => t.status === "valid")).toBe(true);

    const order = await orderRow(orderId);
    expect(order?.downloadToken).toBeTruthy();
    expect(order?.downloadReleasedAt).toBeNull();
  });

  it("unlocks a free event immediately", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id, { priceCents: 0 });
    const orderId = await placedOrder(shop.id, ev.id);
    expect((await orderRow(orderId))?.downloadReleasedAt).not.toBeNull();
  });

  it("unlocks immediately when the seller doesn't hold tickets for payment", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id, { releaseOnPayment: false });
    const orderId = await placedOrder(shop.id, ev.id);
    expect((await orderRow(orderId))?.downloadReleasedAt).not.toBeNull();
  });

  it("mints no tickets for other kinds", async () => {
    const shop = await makeShop();
    const [p] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Mug",
        slug: `p-${uid().slice(0, 8)}`,
        kind: "physical",
        priceCents: 1200,
        isPublished: true,
        inStock: true,
      })
      .returning();
    if (!p) throw new Error("fixture: product was not inserted");
    const orderId = await placedOrder(shop.id, p.id, 2);
    expect(await ticketRows(orderId)).toHaveLength(0);
    expect((await orderRow(orderId))?.downloadToken).toBeNull();
  });

  it("shares one token across a mixed basket, and one hold holds it all", async () => {
    const shop = await makeShop();
    // The event would unlock now; the digital line is held until payment.
    const ev = await makeEvent(shop.id, { releaseOnPayment: false });
    const [dig] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Poster PDF",
        slug: `d-${uid().slice(0, 8)}`,
        kind: "digital",
        priceCents: 500,
        releaseOnPayment: true,
        isPublished: true,
        inStock: true,
      })
      .returning();
    if (!dig) throw new Error("fixture: digital product was not inserted");
    await db.insert(productFiles).values({
      productId: dig.id,
      name: "poster.pdf",
      url: "https://store1.public.blob.vercel-storage.com/poster.pdf",
      sizeBytes: 2048,
      contentType: "application/pdf",
      position: 0,
    });

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [
        { productId: ev.id, quantity: 1 },
        { productId: dig.id, quantity: 1 },
      ],
      paymentMethod: "cod",
      ...buyer,
    });
    if (!r.ok) throw new Error(r.error);

    const order = await orderRow(r.orderId);
    expect(order?.downloadToken).toBeTruthy();
    expect(order?.downloadReleasedAt).toBeNull();
    expect(await ticketRows(r.orderId)).toHaveLength(1);
  });
});

describe("sales close when the doors open", () => {
  it("refuses a ticket for an event that has started", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id, { eventStartsAt: lastWeek() });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: ev.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("closed");
  });

  it("capacity is stock: the room cannot oversell", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id, {
      trackInventory: true,
      stockQuantity: 2,
    });

    // Asking for three of the last two clamps to two — the same rule the
    // storefront picker shows a buyer — and mints exactly two admissions.
    const clamped = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: ev.id, quantity: 3 }],
      paymentMethod: "cod",
      ...buyer,
    });
    if (!clamped.ok) throw new Error(clamped.error);
    expect(await ticketRows(clamped.orderId)).toHaveLength(2);

    // The room is now full; the next buyer is refused outright.
    const refused = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: ev.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(refused.ok).toBe(false);
  });

  it("the last seat, contested concurrently, admits exactly one", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id, {
      trackInventory: true,
      stockQuantity: 1,
    });
    const results = await Promise.all([
      createOrderIntent({
        shopId: shop.id,
        items: [{ productId: ev.id, quantity: 1 }],
        paymentMethod: "cod",
        ...buyer,
      }),
      createOrderIntent({
        shopId: shop.id,
        items: [{ productId: ev.id, quantity: 1 }],
        paymentMethod: "cod",
        ...buyer,
      }),
    ]);
    const admittedOrders = results.filter((r) => r.ok);
    const sold = (
      await Promise.all(
        admittedOrders.map((r) => (r.ok ? ticketRows(r.orderId) : [])),
      )
    ).flat();
    expect(sold).toHaveLength(1);
  });
});

describe("the door", () => {
  async function releasedTicket() {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);
    const orderId = await placedOrder(shop.id, ev.id);
    await releaseDownloads(orderId);
    const [ticket] = await ticketRows(orderId);
    if (!ticket) throw new Error("fixture: no ticket");
    return { shop, ticket };
  }

  it("refuses an unpaid ticket, admits it after release, once", async () => {
    const shop = await makeShop();
    const ev = await makeEvent(shop.id);
    const orderId = await placedOrder(shop.id, ev.id);
    const [ticket] = await ticketRows(orderId);
    if (!ticket) throw new Error("fixture: no ticket was minted");

    expect(
      (await checkInTicketForShop(shop.id, ticket.code)).status,
    ).toBe("not_released");

    await releaseDownloads(orderId);

    const first = await checkInTicketForShop(shop.id, ticket.code);
    expect(first.status).toBe("checked_in");

    const second = await checkInTicketForShop(shop.id, ticket.code);
    expect(second.status).toBe("already_used");
    if (second.status === "already_used") {
      expect(second.usedAt).not.toBeNull();
    }
  });

  it("two phones, one ticket: exactly one admits", async () => {
    const { shop, ticket } = await releasedTicket();
    const results = await Promise.all([
      checkInTicketForShop(shop.id, ticket.code),
      checkInTicketForShop(shop.id, ticket.code),
    ]);
    const admitted = results.filter((r) => r.status === "checked_in");
    expect(admitted).toHaveLength(1);
  });

  it("reads a code however the door typed it", async () => {
    const { shop, ticket } = await releasedTicket();
    const mangled = ticket.code
      .toLowerCase()
      .replace("-", " ")
      .replace(/0/g, "o")
      .replace(/1/g, "l");
    const r = await checkInTicketForShop(shop.id, mangled);
    expect(r.status).toBe("checked_in");
  });

  it("another shop's door does not admit this shop's ticket", async () => {
    const { ticket } = await releasedTicket();
    const stranger = await makeShop();
    const r = await checkInTicketForShop(stranger.id, ticket.code);
    expect(r.status).toBe("not_found");
    // And the failed attempt spent nothing: the ticket still admits at home.
    expect(
      (await db.query.tickets.findFirst({ where: eq(tickets.id, ticket.id) }))
        ?.status,
    ).toBe("valid");
  });

  it("gibberish is not a ticket", async () => {
    const shop = await makeShop();
    expect((await checkInTicketForShop(shop.id, "NOPE!")).status).toBe(
      "not_found",
    );
    expect((await checkInTicketForShop(shop.id, "")).status).toBe("not_found");
  });
});
