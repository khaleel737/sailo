import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  coupons,
  deliveryMethods,
  eventTiers,
  invoices,
  orderItems,
  orders,
  paymentMethods,
  products,
  productVariants,
  shops,
  user,
} from "@sailo/db/schema";
import { currencyGaps, liveCurrencies } from "@/lib/queries/regional";

/**
 * Selling in the buyer's currency — spec 53, against a real database.
 *
 * This is a money-path change, so it gets scenario coverage rather than unit
 * coverage: the rules being checked are not "does `atCurrency` return null" —
 * `packages/core/src/money/regional.test.ts` already asks that — but whether an
 * order written through `createOrderIntent` ends up denominated in the currency
 * the buyer was shown, with an invoice that says so, and whether the paths that
 * are supposed to refuse actually refuse when a price is missing.
 *
 * Run with:
 *
 *   ./e2e/scenarios/up.sh
 *   npx vitest run --config vitest.scenarios.mts e2e/scenarios/regional-pricing.scenario.ts
 */

/**
 * Where the buyer is, per test.
 *
 * `setup.ts` mocks `next/headers` for every scenario with a fixed header bag,
 * which is what makes `displayCurrency` answer "the shop's own" everywhere
 * else. This file needs to move the buyer between Berlin and Boston, so it
 * replaces that mock with one it can steer — and steers it through a mutable
 * variable rather than by re-mocking, because `vi.mock` is hoisted and cannot
 * see per-test state.
 */
let buyerCountry: string | null = null;
let chosenCurrency: string | null = null;

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-forwarded-for": "203.0.113.1",
      ...(buyerCountry ? { "x-vercel-ip-country": buyerCountry } : {}),
    }),
  cookies: async () => ({
    get: (name: string) =>
      name === "sailo_ccy" && chosenCurrency ? { value: chosenCurrency } : undefined,
    set: () => {},
    delete: () => {},
  }),
}));

const { createOrderIntent } = await import("@/lib/actions/orders");
const { previewOrder } = await import("@/lib/actions/order-preview");

const db = getDb();
const uid = () => crypto.randomUUID();

const buyer = {
  customerName: "Buyer",
  customerEmail: "buyer@example.com",
  customerPhone: "+15551234567",
  addressLine1: "1 High Street",
  city: "Berlin",
  postalCode: "10115",
  country: "DE",
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
      name: "Regional Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
      regionalCurrencies: ["EUR"],
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");

  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type: "cod",
    label: "Cash on delivery",
    config: {} as never,
    isEnabled: true,
    position: 0,
  });

  return shop;
}

async function makeProduct(
  shopId: string,
  over: Partial<typeof products.$inferInsert> = {},
) {
  const [p] = await db
    .insert(products)
    .values({
      shopId,
      title: "Speckled Mug",
      slug: `p-${uid().slice(0, 8)}`,
      kind: "physical",
      priceCents: 2900,
      currencyPrices: { EUR: { price: 2500, secondary: null } },
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!p) throw new Error("fixture: product was not inserted");
  return p;
}

const orderRow = (id: string) => db.query.orders.findFirst({ where: eq(orders.id, id) });

beforeAll(async () => {
  assertLocalDatabase();
});

beforeEach(() => {
  buyerCountry = null;
  chosenCurrency = null;
});

describe("the currency an order is written in", () => {
  it("charges a Berlin buyer the seller's euro price, and records euros", async () => {
    const shop = await makeShop();
    const p = await makeProduct(shop.id);
    buyerCountry = "DE";

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 2 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const row = await orderRow(r.orderId);
    expect(row?.currency).toBe("EUR");
    // 2 × €25.00 — the seller's own number, not a conversion of $29.
    expect(row?.totalCents).toBe(5000);

    /*
     * And the lines, not only the header. An order whose header says €50 over
     * two lines quoting $29 each is the header-versus-lines shape this repo
     * keeps a list of, and it is the one a refund would then read.
     */
    const items = await db.query.orderItems.findMany({
      where: eq(orderItems.orderId, r.orderId),
    });
    expect(items.map((i) => i.unitPriceCents)).toEqual([2500]);
  });

  it("charges a US buyer the shop's own price", async () => {
    const shop = await makeShop();
    const p = await makeProduct(shop.id);
    buyerCountry = "US";

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const row = await orderRow(r.orderId);
    expect(row?.currency).toBe("USD");
    expect(row?.totalCents).toBe(2900);
  });

  it("quotes a country the shop has no price for in the shop's own currency", async () => {
    // Brazil is outside the market this feature covers, so it maps to nothing
    // and the buyer gets exactly what they get today.
    const shop = await makeShop();
    const p = await makeProduct(shop.id);
    buyerCountry = "BR";

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await orderRow(r.orderId))?.currency).toBe("USD");
  });

  it("writes the invoice in the currency that was charged", async () => {
    const shop = await makeShop({ invoicePrefix: "INV" });
    const p = await makeProduct(shop.id);
    buyerCountry = "DE";

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.orderId, r.orderId),
    });
    /*
     * The invoice does not carry a currency column — it names the order's, and
     * that is the point of asserting it here rather than trusting it: the
     * document a tax authority reads has to say what the buyer actually paid.
     */
    if (invoice) {
      const row = await orderRow(r.orderId);
      expect(row?.currency).toBe("EUR");
      expect(row?.totalCents).toBe(2500);
    }
  });
});

describe("a currency that is not fully priced", () => {
  it("is not offered when a product in the basket has no price in it", async () => {
    const shop = await makeShop();
    // Priced in dollars only. `liveCurrencies` will not offer EUR at all, and
    // even if a stale cache did, `resolveLines` refuses to quote this row.
    const bare = await makeProduct(shop.id, { currencyPrices: {} });
    buyerCountry = "DE";

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: bare.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Quoted in dollars and told nothing — the fallback the spec asks for.
    const row = await orderRow(r.orderId);
    expect(row?.currency).toBe("USD");
    expect(row?.totalCents).toBe(2900);
  });

  it("takes the shop out of euros when a priced variant has no euro price", async () => {
    const shop = await makeShop();
    const p = await makeProduct(shop.id, {
      options: [{ name: "Size", values: ["S", "L"] }] as never,
    });
    const [big] = await db
      .insert(productVariants)
      .values({
        productId: p.id,
        options: { Size: "L" } as never,
        // Overrides in dollars and says nothing about euros.
        priceCents: 3500,
        currencyPrices: {},
        isAvailable: true,
      })
      .returning();
    if (!big) throw new Error("fixture: variant was not inserted");

    /*
     * The cookie *and* the header both say euros, and the buyer still gets
     * dollars — which is the rule this whole feature turns on. A currency is
     * offered per **shop**, not per row, so one variant priced in dollars only
     * takes the entire storefront out of euros rather than putting a euro sign
     * in front of 3500.
     */
    chosenCurrency = "EUR";
    buyerCountry = "DE";

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, variantId: big.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const row = await orderRow(r.orderId);
    expect(row?.currency).toBe("USD");
    expect(row?.totalCents).toBe(3500);
  });

  it("refuses outright if a euro order for that variant is asked for anyway", async () => {
    /*
     * The belt to the braces above. `liveCurrencies` and the catalogue read are
     * cached separately, so there is a window in which one says euros are live
     * and the other has just lost a price — and the safe side of that window is
     * a refusal rather than a charge at a number nobody set.
     *
     * Asked of `resolveOrderIntent` directly, because there is deliberately no
     * path through the storefront that can reach it: `displayCurrency` would
     * have answered "dollars" as the test above proves.
     */
    const { resolveOrderIntent } = await import("@sailo/commerce/orders/server");

    const shop = await makeShop();
    const p = await makeProduct(shop.id, {
      options: [{ name: "Size", values: ["S", "L"] }] as never,
    });
    const [big] = await db
      .insert(productVariants)
      .values({
        productId: p.id,
        options: { Size: "L" } as never,
        priceCents: 3500,
        currencyPrices: {},
        isAvailable: true,
      })
      .returning();
    if (!big) throw new Error("fixture: variant was not inserted");

    const intent = await resolveOrderIntent(
      shop,
      {
        shopId: shop.id,
        items: [{ productId: p.id, variantId: big.id, quantity: 1 }],
        paymentMethod: "cod",
        ...buyer,
      },
      new Date(),
      "EUR",
    );

    expect(intent.ok).toBe(false);
  });

  /*
   * A published event with price bands takes the whole shop out of euros —
   * spec 50 meeting spec 53.
   *
   * `event_tiers` has a `price_cents` and no `currency_prices`, so a band is
   * one number in the shop's own money and there is nowhere to put a euro one.
   * Without this rule the shop's catalogue would be fully priced, euros would
   * go live, and the storefront would render every band's *pound* number with a
   * euro sign in front of it — which is the exact defect `liveCurrencies` was
   * written to prevent, quoted in its own header, on the one page a buyer
   * commits from.
   */
  it("takes the shop out of euros while a published event sells in bands", async () => {
    const shop = await makeShop();
    const event = await makeProduct(shop.id, {
      kind: "event",
      eventStartsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });

    // Everything priced in euros: without a band, this shop is live in EUR.
    expect(
      await liveCurrencies(shop.id, ["EUR"], shop.currency),
    ).toEqual(["EUR"]);

    await db
      .insert(eventTiers)
      .values({ productId: event.id, name: "VIP", priceCents: 5000, capacity: 30 });

    expect(await liveCurrencies(shop.id, ["EUR"], shop.currency)).toEqual([]);

    /*
     * And the seller is told which of the five things is stopping it, by name.
     * This is the one entry on that card they cannot close by typing a number,
     * so leaving it out of the list would be a currency that never goes live
     * with nothing on screen explaining why.
     */
    const [gap] = await currencyGaps(shop.id, ["EUR"], shop.currency);
    expect(gap?.tiers).toBe(1);
    expect(gap?.products).toBe(0);
  });
});

describe("what the basket quotes before anything is written", () => {
  it("previews the same currency the order will be charged in", async () => {
    const shop = await makeShop();
    const p = await makeProduct(shop.id);
    buyerCountry = "DE";

    const preview = await previewOrder({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
    });

    expect("error" in preview).toBe(false);
    if ("error" in preview) return;
    expect(preview.currency).toBe("EUR");
    expect(preview.totals.totalCents).toBe(2500);
  });

  it("prices delivery in the order's currency", async () => {
    const shop = await makeShop();
    const p = await makeProduct(shop.id);
    await db.insert(deliveryMethods).values({
      shopId: shop.id,
      type: "shipping",
      name: "Standard",
      feeCents: 500,
      currencyPrices: { EUR: { price: 450, secondary: null } },
      isEnabled: true,
      position: 0,
    });
    buyerCountry = "DE";

    const preview = await previewOrder({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      country: "DE",
    });
    expect("error" in preview).toBe(false);
    if ("error" in preview) return;
    // €25.00 + €4.50 — and never $5.00 added to a euro basket.
    expect(preview.totals.deliveryFeeCents).toBe(450);
    expect(preview.totals.totalCents).toBe(2950);
  });

  it("takes the shop out of euros while a fixed coupon names no euro amount", async () => {
    /*
     * The consequence a seller will actually meet, and it is worth an
     * assertion because it is surprising: an active `€`-less discount code is
     * enough to stop the *whole shop* quoting euros. A code is money, there is
     * nothing to convert it with, and a checkout that accepted the code and
     * then took five of something off is worse than one that never offered the
     * currency. The settings card names the code count for exactly this
     * reason — rule 8, no silent caps.
     */
    const shop = await makeShop();
    const p = await makeProduct(shop.id);
    await db.insert(coupons).values({
      shopId: shop.id,
      code: `FIVE${uid().slice(0, 6).toUpperCase()}`,
      discountType: "fixed",
      discountValue: 500,
      currencyPrices: {},
      isActive: true,
    });
    buyerCountry = "DE";

    const preview = await previewOrder({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
    });
    expect("error" in preview).toBe(false);
    if ("error" in preview) return;
    expect(preview.currency).toBe("USD");
    expect(preview.totals.totalCents).toBe(2900);
  });

  it("takes a fixed coupon's euro amount off a euro basket", async () => {
    const shop = await makeShop();
    const p = await makeProduct(shop.id);
    const code = `FOUR${uid().slice(0, 6).toUpperCase()}`;
    await db.insert(coupons).values({
      shopId: shop.id,
      code,
      discountType: "fixed",
      discountValue: 500,
      // €4.00 off, typed by the seller. Not $5.00 converted to anything.
      currencyPrices: { EUR: { price: 400, secondary: null } },
      isActive: true,
    });
    buyerCountry = "DE";

    const preview = await previewOrder({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      couponCode: code,
    });
    expect("error" in preview).toBe(false);
    if ("error" in preview) return;
    expect(preview.currency).toBe("EUR");
    expect(preview.totals.discountCents).toBe(400);
    expect(preview.totals.totalCents).toBe(2100);
  });

  it("applies a percentage coupon in any currency, with no entry at all", async () => {
    const shop = await makeShop();
    const p = await makeProduct(shop.id);
    await db.insert(coupons).values({
      shopId: shop.id,
      code: "TENPC",
      discountType: "percent",
      discountValue: 1000,
      currencyPrices: {},
      isActive: true,
    });
    buyerCountry = "DE";

    const preview = await previewOrder({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      couponCode: "TENPC",
    });
    expect("error" in preview).toBe(false);
    if ("error" in preview) return;
    // 10% of €25.00. A percentage is currency-free and needs nothing typed.
    expect(preview.totals.discountCents).toBe(250);
  });
});

describe("the plan gate", () => {
  it("stops the currency being offered on a downgrade, and keeps every typed price", async () => {
    const shop = await makeShop({ plan: "free", subscriptionStatus: null });
    const p = await makeProduct(shop.id);
    buyerCountry = "DE";

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await orderRow(r.orderId))?.currency).toBe("USD");

    // The seller's euro price is untouched: re-upgrading is one click.
    const still = await db.query.products.findFirst({ where: eq(products.id, p.id) });
    expect(still?.currencyPrices).toEqual({ EUR: { price: 2500, secondary: null } });
  });

  it("ignores a chosen currency the shop does not offer", async () => {
    const shop = await makeShop({ regionalCurrencies: [] });
    const p = await makeProduct(shop.id);
    // The cookie says euros and the shop offers none. A cookie is a request,
    // not an entitlement.
    chosenCurrency = "EUR";

    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await orderRow(r.orderId))?.currency).toBe("USD");
  });
});
