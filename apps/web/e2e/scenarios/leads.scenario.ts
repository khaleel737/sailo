import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  clients,
  invoices,
  leads,
  orderItems,
  orders,
  paymentMethods,
  productFiles,
  products,
  shops,
  user,
} from "@sailo/db/schema";
import { captureLead } from "@/lib/actions/leads";
import { createOrderIntent } from "@/lib/actions/orders";
import { getDashboardStats } from "@sailo/analytics";
import { hashMagnetToken, magnetForToken } from "@sailo/marketing/leads/server";

/**
 * Spec 07's whole claim, against a real database: **a lead never touches the
 * money ledger.**
 *
 * That is not something a unit test can show. What has to be true is that a
 * submission writes a contact and a lead row and *nothing else* — no order, no
 * order line, no invoice number out of a sequence a tax authority expects to
 * describe trade — and the only way to know is to count the rows afterwards.
 *
 * The second claim is the mirror of it: a lead product cannot be bought.
 * `resolveLines` refuses one, and the test that matters is the one that posts a
 * perfectly ordinary basket payload naming a lead product, the way a
 * hand-rolled request would.
 *
 * Run with:
 *   npx dotenv -e .env.local.test -- \
 *     npx vitest run --config vitest.scenarios.mts e2e/scenarios/leads.scenario.ts
 */

const db = getDb();
const uid = () => crypto.randomUUID();

/*
 * Both emails, intercepted. The magnet link is the only thing that opens the
 * file, so a test that cannot read it cannot check what it opens — and "the
 * seller is told once" is a count, which needs somewhere to count.
 */
const outbox = vi.hoisted(() => ({
  magnets: [] as { to: string; url: string }[],
  seller: [] as { to: string; leadEmail: string }[],
}));

vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendLeadMagnet: async (opts: { to: string; url: string }) => {
    outbox.magnets.push({ to: opts.to, url: opts.url });
    return { sent: true as const, id: `scenario-${outbox.magnets.length}` };
  },
}));

/*
 * Mocked at `@sailo/workflows/leads` rather than at the mail builder, because
 * that is the module `captureLead` actually imports — a mock on
 * `@sailo/email/shop` is applied to the graph the workflows package resolves
 * for itself, which is a different instance.
 */
vi.mock("@sailo/workflows/leads", () => ({
  notifySellerOfLead: async (opts: {
    shop: { contactEmail: string | null };
    email: string;
  }) => {
    outbox.seller.push({
      to: opts.shop.contactEmail ?? "",
      leadEmail: opts.email,
    });
  },
}));

beforeAll(() => {
  assertLocalDatabase();
});

beforeEach(() => {
  outbox.magnets.length = 0;
  outbox.seller.length = 0;
});

async function makeShop(over: Partial<typeof shops.$inferInsert> = {}) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `lead-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `lead-${userId.slice(0, 8)}`,
      name: "Lead Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
      contactEmail: "seller@example.com",
      ...over,
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

async function makeLeadProduct(
  shopId: string,
  over: Partial<typeof products.$inferInsert> = {},
) {
  const [p] = await db
    .insert(products)
    .values({
      shopId,
      title: "The Checklist",
      slug: `l-${uid().slice(0, 8)}`,
      kind: "lead",
      priceCents: 0,
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!p) throw new Error("fixture: product was not inserted");
  return p;
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

async function moneyRowsFor(shopId: string) {
  const [orderRows, invoiceRows] = await Promise.all([
    db.select({ id: orders.id }).from(orders).where(eq(orders.shopId, shopId)),
    db.select({ id: invoices.id }).from(invoices).where(eq(invoices.shopId, shopId)),
  ]);
  return { orders: orderRows.length, invoices: invoiceRows.length };
}

describe("a submission", () => {
  it("writes a contact and a lead, and nothing money-shaped at all", async () => {
    const shop = await makeShop();
    const product = await makeLeadProduct(shop.id);

    const result = await captureLead(
      { done: false },
      form({ productId: product.id, email: "Ada@Example.com", name: "Ada" }),
    );
    expect(result.done).toBe(true);

    const [lead] = await db
      .select()
      .from(leads)
      .where(eq(leads.productId, product.id));
    // Folded on the way in, so a resubmission in different casing is the same
    // person rather than a second row.
    expect(lead!.email).toBe("ada@example.com");
    expect(lead!.name).toBe("Ada");

    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.shopId, shop.id));
    expect(client!.source).toBe("lead");
    // The box was never shown, so nothing may have been granted.
    expect(client!.marketingConsentAt).toBeNull();
    expect(lead!.clientId).toBe(client!.id);

    expect(await moneyRowsFor(shop.id)).toEqual({ orders: 0, invoices: 0 });
  });

  it("updates rather than duplicating when the same address comes back", async () => {
    const shop = await makeShop();
    const product = await makeLeadProduct(shop.id, {
      leadQuestions: [{ id: "team-1", label: "Which team?", required: false }],
    });

    await captureLead(
      { done: false },
      form({ productId: product.id, email: "ada@example.com", "answer:team-1": "Ops" }),
    );
    await captureLead(
      { done: false },
      form({ productId: product.id, email: "ADA@example.com", "answer:team-1": "Finance" }),
    );

    const rows = await db.select().from(leads).where(eq(leads.productId, product.id));
    expect(rows).toHaveLength(1);
    // Answers are replaced, not merged: somebody filling the form in again is
    // correcting what they said.
    expect(rows[0]!.answers).toEqual([
      { id: "team-1", label: "Which team?", value: "Finance" },
    ]);
  });

  it("records consent only when the shop asked and the visitor ticked", async () => {
    const asking = await makeShop({ askMarketingConsent: true });
    const askingProduct = await makeLeadProduct(asking.id);

    await captureLead(
      { done: false },
      form({ productId: askingProduct.id, email: "ticked@example.com", marketingOptIn: "on" }),
    );
    await captureLead(
      { done: false },
      form({ productId: askingProduct.id, email: "untouched@example.com" }),
    );

    const rows = await db
      .select()
      .from(clients)
      .where(eq(clients.shopId, asking.id));
    const byEmail = new Map(rows.map((r) => [r.email, r]));
    expect(byEmail.get("ticked@example.com")!.marketingConsentAt).not.toBeNull();
    expect(byEmail.get("untouched@example.com")!.marketingConsentAt).toBeNull();

    /*
     * And the flag on its own grants nothing. The client composes the body, so
     * a shop whose form never showed the box must not be able to have consent
     * asserted into it.
     */
    const silent = await makeShop({ askMarketingConsent: false });
    const silentProduct = await makeLeadProduct(silent.id);
    await captureLead(
      { done: false },
      form({ productId: silentProduct.id, email: "claimed@example.com", marketingOptIn: "on" }),
    );
    const [claimed] = await db
      .select()
      .from(clients)
      .where(eq(clients.shopId, silent.id));
    expect(claimed!.marketingConsentAt).toBeNull();
  });

  it("refuses a required question and stores nothing", async () => {
    const shop = await makeShop();
    const product = await makeLeadProduct(shop.id, {
      leadQuestions: [{ id: "budget-1", label: "Your budget?", required: true }],
    });

    const result = await captureLead(
      { done: false },
      form({ productId: product.id, email: "ada@example.com" }),
    );
    expect(result.done).toBe(false);
    expect(result.error).toContain("Your budget?");
    expect(await db.select().from(leads).where(eq(leads.productId, product.id))).toEqual([]);
  });

  it("stores only the questions the product actually asks", async () => {
    const shop = await makeShop();
    const product = await makeLeadProduct(shop.id, {
      leadQuestions: [{ id: "team-1", label: "Which team?", required: false }],
    });

    await captureLead(
      { done: false },
      form({
        productId: product.id,
        email: "ada@example.com",
        "answer:team-1": "Ops",
        // Not on the form. A body naming a question the seller never asked is
        // a body making one up, and storing it would be arbitrary jsonb on a
        // seller's contact record.
        "answer:invented": "anything at all",
      }),
    );

    const [lead] = await db.select().from(leads).where(eq(leads.productId, product.id));
    expect(lead!.answers).toEqual([
      { id: "team-1", label: "Which team?", value: "Ops" },
    ]);
  });

  it("tells the seller, once", async () => {
    const shop = await makeShop();
    const product = await makeLeadProduct(shop.id);
    await captureLead(
      { done: false },
      form({ productId: product.id, email: "ada@example.com" }),
    );
    expect(outbox.seller).toEqual([
      { to: "seller@example.com", leadEmail: "ada@example.com" },
    ]);
  });

  it("says nothing different about an address it has seen before", async () => {
    /*
     * The anti-oracle property, and the one worth a test: the sentence a
     * visitor gets is chosen by the *product* — whether the seller attached a
     * file — and never by whether this address is already on the list.
     */
    const shop = await makeShop();
    const product = await makeLeadProduct(shop.id);

    const first = await captureLead(
      { done: false },
      form({ productId: product.id, email: "known@example.com" }),
    );
    const second = await captureLead(
      { done: false },
      form({ productId: product.id, email: "known@example.com" }),
    );
    const stranger = await captureLead(
      { done: false },
      form({ productId: product.id, email: "stranger@example.com" }),
    );

    expect(second).toEqual(first);
    expect(stranger.message).toBe(first.message);
  });
});

describe("the magnet", () => {
  it("mints a link that opens this lead's product and no other", async () => {
    const shop = await makeShop();
    const product = await makeLeadProduct(shop.id, { downloadExpiryDays: 7 });
    await db.insert(productFiles).values({
      productId: product.id,
      name: "checklist.pdf",
      url: "https://store123.public.blob.vercel-storage.com/checklist.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
    });

    await captureLead(
      { done: false },
      form({ productId: product.id, email: "ada@example.com" }),
    );

    expect(outbox.magnets).toHaveLength(1);
    const token = outbox.magnets[0]!.url.split("/").at(-1)!;

    // The plain token is never stored — only its hash, the same rule the API
    // keys and the data-request tokens follow.
    const [lead] = await db.select().from(leads).where(eq(leads.productId, product.id));
    expect(lead!.magnetTokenHash).toBe(hashMagnetToken(token));
    expect(lead!.magnetTokenHash).not.toBe(token);
    expect(lead!.magnetExpiresAt).not.toBeNull();

    const grant = await magnetForToken(token);
    expect(grant?.product.id).toBe(product.id);
    expect(await magnetForToken("not-a-real-token-at-all")).toBeNull();
  });

  it("sends nothing when there is no file, and says so differently", async () => {
    const shop = await makeShop();
    const product = await makeLeadProduct(shop.id);

    const result = await captureLead(
      { done: false },
      form({ productId: product.id, email: "ada@example.com" }),
    );
    expect(outbox.magnets).toEqual([]);
    // "Check your inbox" would be a small lie that fills a seller's support
    // inbox, so the copy for a magnet-less form is its own sentence.
    expect(result.message).toContain("Lead Shop");
  });

  it("stops the old link working when a new one is minted", async () => {
    const shop = await makeShop();
    const product = await makeLeadProduct(shop.id);
    await db.insert(productFiles).values({
      productId: product.id,
      name: "checklist.pdf",
      url: "https://store123.public.blob.vercel-storage.com/checklist.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
    });

    await captureLead({ done: false }, form({ productId: product.id, email: "ada@example.com" }));
    const first = outbox.magnets[0]!.url.split("/").at(-1)!;

    // A second submission mints a fresh token, which is the revocation half of
    // "single-audience, revocable" — and it is what lets somebody who lost the
    // email get the file again without the seller doing anything.
    await db
      .update(leads)
      .set({ updatedAt: new Date(0) })
      .where(eq(leads.productId, product.id));
    await captureLead({ done: false }, form({ productId: product.id, email: "ada@example.com" }));
    const second = outbox.magnets.at(-1)!.url.split("/").at(-1)!;

    expect(second).not.toBe(first);
    expect(await magnetForToken(first)).toBeNull();
    expect(await magnetForToken(second)).not.toBeNull();
  });
});

describe("a lead product is not something to buy", () => {
  it("refuses an ordinary checkout payload naming one", async () => {
    const shop = await makeShop();
    const product = await makeLeadProduct(shop.id);

    const result = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "cod",
      customerName: "Buyer",
      customerEmail: "buyer@example.com",
      addressLine1: "1 High Street",
      city: "Leeds",
    });
    expect(result.ok).toBe(false);

    // Not a single row on the money side, including the lines table — a
    // header-only check would miss an order that got as far as its items.
    const [lines] = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(eq(orders.shopId, shop.id));
    expect(lines).toBeUndefined();
    expect(await moneyRowsFor(shop.id)).toEqual({ orders: 0, invoices: 0 });
  });

  it("counts on the dashboard as leads and not as revenue", async () => {
    const shop = await makeShop();
    const product = await makeLeadProduct(shop.id);
    await captureLead({ done: false }, form({ productId: product.id, email: "a@example.com" }));
    await captureLead({ done: false }, form({ productId: product.id, email: "b@example.com" }));

    const stats = await getDashboardStats(shop.id, 30);
    expect(stats.leadsInRange).toBe(2);
    expect(stats.totalOrders).toBe(0);
    expect(stats.grossCents).toBe(0);
  });
});

describe("a shop that is not taking anything", () => {
  it("says the same thing for a draft product as for a real one", async () => {
    const shop = await makeShop();
    const draft = await makeLeadProduct(shop.id, { isPublished: false });
    const missing = await captureLead(
      { done: false },
      form({ productId: crypto.randomUUID(), email: "ada@example.com" }),
    );
    const unpublished = await captureLead(
      { done: false },
      form({ productId: draft.id, email: "ada@example.com" }),
    );
    // Same sentence either way: the id came from the page the visitor is
    // standing on, so a miss is our routing being wrong rather than a fact
    // about the shop's catalogue.
    expect(unpublished.error).toBe(missing.error);
    expect(unpublished.done).toBe(false);
  });

  it("takes nothing for a suspended shop", async () => {
    const shop = await makeShop({ suspendedAt: new Date() });
    const product = await makeLeadProduct(shop.id);
    const result = await captureLead(
      { done: false },
      form({ productId: product.id, email: "ada@example.com" }),
    );
    expect(result.done).toBe(false);
    expect(await db.select().from(leads).where(eq(leads.shopId, shop.id))).toEqual([]);
  });
});
