import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  deliveryMethods,
  invoices,
  orders,
  paymentMethods,
  productFiles,
  products,
  shops,
  user,
} from "@sailo/db/schema";
import { createOrderIntent } from "@/lib/actions/orders";
import { getCheckoutMethods } from "@/lib/queries/checkout";
import type { Handoff } from "@/lib/payments";

/**
 * The US wallet rails, against a database we are allowed to dirty.
 *
 * Venmo and PayPal are the first rails whose handoff carries a *number*. Every
 * other manual rail hands the buyer a page of instructions the seller wrote,
 * so an error in it is visible to the person who wrote it; these build a URL
 * with the amount inside, and a wrong amount is a link that quietly charges
 * the wrong money at a domain we do not control. Unit tests cover the URL
 * shape from a hand-made summary — this covers the number arriving there from
 * a real order, through the real action, with delivery and stock and an
 * invoice in the way.
 *
 *   ./e2e/scenarios/up.sh
 *   npx vitest run --config vitest.scenarios.mts
 */

const db = getDb();
const uid = () => crypto.randomUUID();

const buyer = {
  customerName: "Buyer",
  customerEmail: "buyer@example.com",
  customerPhone: "+15551234567",
  addressLine1: "1 High Street",
  city: "Portland",
  postalCode: "97201",
  country: "US",
};

async function makeShop(over: Partial<typeof shops.$inferInsert> = {}) {
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
      name: "Clay & Co",
      currency: "USD",
      isPublished: true,
      // Free on purpose. Venmo and PayPal are manual rails, so unlike card they
      // are not gated on `cardRails` — a seller who has never touched Stripe
      // must be able to take money, which is the whole reason they exist.
      plan: "free",
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

async function withWallet(type: string, config: Record<string, string>) {
  const shop = await makeShop();
  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type,
    label: type,
    config: config as never,
    isEnabled: true,
    position: 0,
  });
  return shop;
}

async function makeProduct(shopId: string, over: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db
    .insert(products)
    .values({
      shopId,
      title: "Speckled mug",
      slug: `p-${uid().slice(0, 8)}`,
      kind: "physical",
      priceCents: 2000,
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!p) throw new Error("fixture: product was not inserted");
  return p;
}

const orderRow = (id: string) => db.query.orders.findFirst({ where: eq(orders.id, id) });

/** The pay link, or a failed test naming what came back instead. */
function payUrlOf(handoff: Handoff | null): string {
  if (handoff?.kind !== "instructions" || !handoff.payUrl) {
    throw new Error(`expected a pay link, got ${JSON.stringify(handoff)}`);
  }
  return handoff.payUrl;
}

beforeAll(async () => {
  assertLocalDatabase();
});

describe("a Venmo order", () => {
  it("persists the order before handing the buyer to Venmo", async () => {
    const shop = await withWallet("venmo", { venmoHandle: "clayandco" });
    const p = await makeProduct(shop.id);

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "venmo",
      ...buyer,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const o = await orderRow(r.orderId);
    // The row exists and is honest about not being paid. Venmo settles off
    // platform and tells us nothing, so anything other than unpaid here would
    // be the app inventing a payment.
    expect(o?.status).toBe("new");
    expect(o?.paymentStatus).toBe("unpaid");
    expect(o?.paymentMethod).toBe("venmo");
  });

  it("keeps the buyer on the page rather than redirecting", async () => {
    // A redirect would strand the order: it stays unpaid until the buyer comes
    // back and submits a reference, and there is no way back from venmo.com.
    const shop = await withWallet("venmo", { venmoHandle: "clayandco" });
    const p = await makeProduct(shop.id);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "venmo",
      ...buyer,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.handoff?.kind).toBe("instructions");
  });

  it("asks for the order total, not the subtotal", async () => {
    // The failure this exists for: a $20 mug with $5 postage sending the buyer
    // to a link that pays $20. It is one line of difference and the seller only
    // finds out when they pack the parcel.
    const shop = await withWallet("venmo", { venmoHandle: "clayandco" });
    const [rate] = await db
      .insert(deliveryMethods)
      .values({
        shopId: shop.id,
        type: "shipping",
        name: "Post",
        feeCents: 500,
        isEnabled: true,
        position: 0,
      })
      .returning();
    if (!rate) throw new Error("fixture: delivery method was not inserted");
    const p = await makeProduct(shop.id, { priceCents: 2000 });

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "venmo",
      deliveryMethodId: rate.id,
      ...buyer,
    });
    if (!r.ok) throw new Error(r.error);

    const o = await orderRow(r.orderId);
    expect(o?.totalCents).toBe(2500);

    const url = payUrlOf(r.handoff);
    expect(new URL(url).searchParams.get("amount")).toBe("25.00");
  });

  it("names the invoice in the note and nothing else about the buyer", async () => {
    // A Venmo note is public on the sender's feed by default.
    const shop = await withWallet("venmo", { venmoHandle: "clayandco" });
    const p = await makeProduct(shop.id);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "venmo",
      ...buyer,
    });
    if (!r.ok) throw new Error(r.error);

    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.orderId, r.orderId),
    });
    if (!invoice) throw new Error("expected an invoice to have been claimed");

    const note = new URL(payUrlOf(r.handoff)).searchParams.get("note") ?? "";
    expect(note).toContain(invoice.number);
    expect(note).not.toContain("High Street");
    expect(note).not.toContain("Buyer");
  });

  it("holds a digital file until the seller confirms the money arrived", async () => {
    const shop = await withWallet("venmo", { venmoHandle: "clayandco" });
    const p = await makeProduct(shop.id, { kind: "digital", releaseOnPayment: true });
    await db.insert(productFiles).values({
      productId: p.id,
      name: "guide.pdf",
      url: "https://store1.public.blob.vercel-storage.com/guide.pdf",
      sizeBytes: 1024,
      contentType: "application/pdf",
      position: 0,
    });

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "venmo",
      ...buyer,
    });
    if (!r.ok) throw new Error(r.error);

    const o = await orderRow(r.orderId);
    // A token exists, but the clock that opens it has not started. Nothing
    // about Venmo tells us the money moved, so the file waits for the seller.
    expect(o?.downloadToken).toBeTruthy();
    expect(o?.downloadReleasedAt).toBeNull();
  });
});

describe("a PayPal order", () => {
  it("carries the total and the shop's currency in the link", async () => {
    const shop = await withWallet("paypal", { paypalMe: "clayandco" });
    const p = await makeProduct(shop.id, { priceCents: 4550 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "paypal",
      ...buyer,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.handoff?.kind === "instructions" && r.handoff.payUrl).toBe(
      "https://paypal.me/clayandco/45.50USD",
    );
  });
});

describe("what the storefront offers", () => {
  it("shows both wallets on a free shop", async () => {
    // Card is gated on the Business plan. These are not, and must not become
    // so — a seller who cannot pass Stripe's KYC is exactly who they are for.
    const shop = await withWallet("venmo", { venmoHandle: "clayandco" });
    await db.insert(paymentMethods).values({
      shopId: shop.id,
      type: "paypal",
      label: "paypal",
      config: { paypalMe: "clayandco" } as never,
      isEnabled: true,
      position: 1,
    });

    const rails = await getCheckoutMethods(shop.id);
    expect(rails.map((r) => r.type).toSorted()).toEqual(["paypal", "venmo"]);
  });

  it("hides a wallet the seller enabled but never filled in", async () => {
    // Half-configured is hidden rather than shown broken: the buyer would pick
    // it, get no link, and the seller would never learn why the sale died.
    const shop = await withWallet("venmo", {});
    const rails = await getCheckoutMethods(shop.id);
    expect(rails).toHaveLength(0);
  });

  it("refuses an order on a wallet that is not configured", async () => {
    // The panel is a suggestion the browser is free to ignore, so the server
    // decides again.
    const shop = await withWallet("venmo", {});
    const p = await makeProduct(shop.id);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "venmo",
      ...buyer,
    });
    expect(r.ok).toBe(false);
  });
});
