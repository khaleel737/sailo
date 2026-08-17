import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  bookingClaims,
  clients,
  coupons,
  deliveryMethods,
  orderItems,
  orders,
  paymentMethods,
  productFiles,
  products,
  shops,
  user,
} from "@sailo/db/schema";
import { createOrderIntent } from "@/lib/actions/orders";
import { abandonOrder, releaseAbandonedCheckouts, restoreStock } from "@sailo/commerce/catalog";
import { exportClients } from "@/lib/exporters";

/**
 * The money path, against a database we are allowed to dirty.
 *
 * No test in this repo has ever called `createOrderIntent`. Not an oversight:
 * the only database the app could reach was production's, so a test that placed
 * an order wrote real rows, decremented real stock and claimed a real invoice
 * number out of a sequence a tax authority expects unbroken. Every "e2e green"
 * claim made while changing this function meant "the checkout panel still
 * renders", and nothing more.
 *
 * `e2e/scenarios/up.sh` gives it somewhere safe to write. Run with:
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
  city: "Leeds",
  postalCode: "LS1 1AA",
  country: "UK",
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
      name: "Test Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

async function withRail(over: Partial<typeof shops.$inferInsert> = {}, type = "cod") {
  const shop = await makeShop(over);
  await db.insert(paymentMethods).values({
    shopId: shop.id,
    type,
    label: type,
    // Bank transfer names one required field; the pay-in-person rails name
    // none. Filling it here lets a test pick bank transfer for the settles-
    // later behaviour without the rail being judged unconfigured.
    config: (type === "bank_transfer"
      ? {
          bankName: "Test Bank",
          accountName: "Checkout Ltd",
          accountNumber: "12345678",
        }
      : {}) as never,
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
      title: "Test Product",
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

/**
 * A digital product with a file attached.
 *
 * `resolveDigitalDelivery` mints a token only when a line actually has
 * something to deliver, which is right — a "digital" product with no files
 * would otherwise hand the buyer a download link to nothing.
 */
async function makeDigitalProduct(shopId: string, over: Partial<typeof products.$inferInsert> = {}) {
  const p = await makeProduct(shopId, { kind: "digital", releaseOnPayment: true, ...over });
  await db.insert(productFiles).values({
    productId: p.id,
    name: "guide.pdf",
    url: "https://store1.public.blob.vercel-storage.com/guide.pdf",
    sizeBytes: 1024,
    contentType: "application/pdf",
    position: 0,
  });
  return p;
}

const orderRow = (id: string) => db.query.orders.findFirst({ where: eq(orders.id, id) });
const stockOf = async (id: string) =>
  (await db.query.products.findFirst({ where: eq(products.id, id) }))?.stockQuantity;

beforeAll(async () => {
  // Fails loudly rather than silently running against whatever DATABASE_URL is
  // set — which, without the scenario setup, is production's.
  assertLocalDatabase();
});

describe("who may sell", () => {
  it("takes an order for a live shop", async () => {
    const shop = await withRail();
    const p = await makeProduct(shop.id);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
  });

  it("refuses a suspended shop", async () => {
    const shop = await withRail({ suspendedAt: new Date() });
    const p = await makeProduct(shop.id);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(false);
  });

  it("refuses an unpublished shop", async () => {
    const shop = await withRail({ isPublished: false });
    const p = await makeProduct(shop.id);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(false);
  });

  it("refuses a rail the shop has not enabled", async () => {
    const shop = await withRail();
    const p = await makeProduct(shop.id);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "bank_transfer",
      ...buyer,
    });
    expect(r.ok).toBe(false);
  });

  it("refuses a product belonging to another shop", async () => {
    const mine = await withRail();
    const theirs = await makeShop();
    const p = await makeProduct(theirs.id, { priceCents: 100 });
    const r = await createOrderIntent({
      shopId: mine.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(false);
  });
});

describe("what the order costs", () => {
  it("prices from the shop, never from the browser", async () => {
    const shop = await withRail();
    const p = await makeProduct(shop.id, { priceCents: 5000 });
    const r = await createOrderIntent({
      shopId: shop.id,
      // A hand-rolled POST can send anything; none of it may reach the total.
      items: [{ productId: p.id, quantity: 1, unitPriceCents: 1 } as never],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await orderRow(r.orderId))?.totalCents).toBe(5000);
  });

  it("adds exclusive tax on top", async () => {
    const shop = await withRail({ taxEnabled: true, taxName: "VAT", taxRateBp: 2000, taxInclusive: false });
    const p = await makeProduct(shop.id, { priceCents: 1000 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = await orderRow(r.orderId);
    expect(o?.totalCents).toBe(1200);
    expect(o?.taxCents).toBe(200);
  });

  it("carves inclusive tax out rather than adding it", async () => {
    // The buyer pays the shelf price; the tax is already inside it.
    const shop = await withRail({ taxEnabled: true, taxName: "VAT", taxRateBp: 2000, taxInclusive: true });
    const p = await makeProduct(shop.id, { priceCents: 1200 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = await orderRow(r.orderId);
    expect(o?.totalCents).toBe(1200);
    expect(o?.taxCents).toBe(200);
  });

  it("adds a delivery fee", async () => {
    const shop = await withRail();
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
      paymentMethod: "cod",
      deliveryMethodId: rate.id,
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = await orderRow(r.orderId);
    expect(o?.deliveryFeeCents).toBe(500);
    expect(o?.totalCents).toBe(2500);
  });

  /*
   * Shipping zones, end to end.
   *
   * The panel narrows the country list and hides the rates that can't reach
   * it, but the panel is a browser and this is the only place the answer
   * counts. Every case here is a request the panel would never send.
   */
  describe("shipping zones", () => {
    async function withRate(countries: string[]) {
      const shop = await withRail();
      const [rate] = await db
        .insert(deliveryMethods)
        .values({
          shopId: shop.id,
          type: "shipping",
          name: "Post",
          feeCents: 500,
          countries,
          isEnabled: true,
          position: 0,
        })
        .returning();
      if (!rate) throw new Error("fixture: delivery method was not inserted");
      const product = await makeProduct(shop.id, { priceCents: 2000 });
      return { shop, rate, product };
    }

    it("refuses an order for a country the rate does not reach", async () => {
      const { shop, rate, product } = await withRate(["HR"]);
      const r = await createOrderIntent({
        shopId: shop.id,
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "cod",
        deliveryMethodId: rate.id,
        ...buyer,
        country: "DE",
      });
      expect(r.ok).toBe(false);
      // Named, because the seller reads this in a support thread as often as
      // the buyer reads it at checkout.
      if (!r.ok) expect(r.error).toContain("Germany");
    });

    it("takes the order when the country is in the zone", async () => {
      const { shop, rate, product } = await withRate(["HR", "DE"]);
      const r = await createOrderIntent({
        shopId: shop.id,
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "cod",
        deliveryMethodId: rate.id,
        ...buyer,
        country: "de",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const o = await orderRow(r.orderId);
      expect(o?.deliveryFeeCents).toBe(500);
      // Stored as the code, which is what a zone, a filter and an export can
      // all be asked about.
      expect(o?.country).toBe("DE");
    });

    it("refuses a restricted rate when no country was given at all", async () => {
      /*
       * The direction that matters. Letting a blank field through would make
       * the whole feature opt-out: anyone posting the form without a country
       * would be shipped to.
       */
      const { shop, rate, product } = await withRate(["HR"]);
      const r = await createOrderIntent({
        shopId: shop.id,
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "cod",
        deliveryMethodId: rate.id,
        ...buyer,
        country: "",
      });
      expect(r.ok).toBe(false);
    });

    it("does not quietly fall back to another rate", async () => {
      /*
       * `resolveDelivery` falls back to the shop's first option when the id it
       * was handed is stale, which is right — a cached page is the buyer's
       * fault least of all. Applied after the zone filter it would have been a
       * hole: ask for the excluded Croatia-only rate from Germany and get the
       * worldwide one, at its price, with the seller none the wiser. The
       * fallback still has to happen *within* what reaches the buyer.
       */
      const shop = await withRail();
      await db.insert(deliveryMethods).values([
        {
          shopId: shop.id,
          type: "shipping",
          name: "Domestic",
          feeCents: 300,
          countries: ["HR"],
          isEnabled: true,
          position: 0,
        },
        {
          shopId: shop.id,
          type: "shipping",
          name: "International",
          feeCents: 900,
          countries: [],
          isEnabled: true,
          position: 1,
        },
      ]);
      const product = await makeProduct(shop.id, { priceCents: 2000 });
      const r = await createOrderIntent({
        shopId: shop.id,
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "cod",
        // No id at all: the fallback path, from a country only one rate reaches.
        ...buyer,
        country: "DE",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const o = await orderRow(r.orderId);
      expect(o?.deliveryFeeCents).toBe(900);
    });

    it("leaves a shop with no zones exactly as it was", async () => {
      // The backfill, asserted rather than assumed: an empty `countries` is
      // anywhere, and every rate that existed before this feature has one.
      const { shop, rate, product } = await withRate([]);
      const r = await createOrderIntent({
        shopId: shop.id,
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "cod",
        deliveryMethodId: rate.id,
        ...buyer,
        country: "JP",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect((await orderRow(r.orderId))?.deliveryFeeCents).toBe(500);
    });

    it("ignores a zone on a collection", async () => {
      // A pickup happens at the seller's address; where the buyer lives is not
      // the seller's business, even if a zone somehow reached the row.
      const shop = await withRail();
      const [rate] = await db
        .insert(deliveryMethods)
        .values({
          shopId: shop.id,
          type: "collection",
          name: "Studio pickup",
          feeCents: 0,
          countries: ["HR"],
          config: { address: "412 NE Alberta Street" },
          isEnabled: true,
          position: 0,
        })
        .returning();
      if (!rate) throw new Error("fixture: delivery method was not inserted");
      const product = await makeProduct(shop.id, { priceCents: 2000 });
      const r = await createOrderIntent({
        shopId: shop.id,
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "cod",
        deliveryMethodId: rate.id,
        ...buyer,
        country: "JP",
      });
      expect(r.ok).toBe(true);
    });
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["fractional", 1.7],
  ])("cannot be given a %s quantity that produces a bad total", async (_label, quantity) => {
    const shop = await withRail();
    const p = await makeProduct(shop.id, { priceCents: 1000 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity }],
      paymentMethod: "cod",
      ...buyer,
    });
    if (!r.ok) return; // refusing is a valid answer
    const o = await orderRow(r.orderId);
    expect(o?.totalCents).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(o?.totalCents)).toBe(true);
  });
});

describe("stock", () => {
  it("reserves units at checkout", async () => {
    const shop = await withRail();
    const p = await makeProduct(shop.id, { trackInventory: true, stockQuantity: 3 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 2 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    expect(await stockOf(p.id)).toBe(1);
  });

  it("never oversells", async () => {
    const shop = await withRail();
    const p = await makeProduct(shop.id, { trackInventory: true, stockQuantity: 3 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 99 }],
      paymentMethod: "cod",
      ...buyer,
    });
    // Either refused outright or clamped — but never a negative shelf.
    expect(await stockOf(p.id)).toBeGreaterThanOrEqual(0);
    if (r.ok) expect((await orderRow(r.orderId))?.totalCents).toBeGreaterThanOrEqual(0);
  });

  it("does not oversell when two buyers race for the last unit", async () => {
    // The check and the decrement are one statement precisely so this holds.
    const shop = await withRail();
    const p = await makeProduct(shop.id, { trackInventory: true, stockQuantity: 1 });
    const both = await Promise.all(
      [1, 2].map((n) =>
        createOrderIntent({
          shopId: shop.id,
          items: [{ productId: p.id, quantity: 1 }],
          paymentMethod: "cod",
          ...buyer,
          // Two different people, so the shared-client upsert is not what is
          // under test here.
          customerEmail: `racer${n}@example.com`,
        }),
      ),
    );
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(await stockOf(p.id)).toBe(0);
  });
});

describe("digital delivery", () => {
  it("mints a token and holds the files until payment", async () => {
    // Bank transfer, not cash on delivery: a download sold on its own has no
    // doorstep for cash to change hands at, so the pay-in-person rail is now
    // refused for it. Bank transfer settles later in the same way, which is
    // what this test is really about — the file waits for the seller to
    // confirm the money.
    const shop = await withRail({}, "bank_transfer");
    const p = await makeDigitalProduct(shop.id);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "bank_transfer",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = await orderRow(r.orderId);
    expect(o?.downloadToken).toBeTruthy();
    expect(o?.downloadReleasedAt).toBeNull();
  });

  it("refuses cash-in-person for a file that unlocks before payment", async () => {
    // The safety boundary of the pay-in-person rule: a held file (above) is
    // fine on cod because the seller confirms the cash before releasing it. A
    // file that unlocks on order is not — "pay when we meet" would hand it over
    // for free — so the rail is refused. This is the one case that must stay
    // closed, whatever else the rail rule allows.
    const shop = await withRail();
    const instant = await makeDigitalProduct(shop.id, { releaseOnPayment: false });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: instant.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(false);
  });

  it("gives a mixed basket its token too", async () => {
    /*
     * The bug this pins cost a buyer their files permanently: delivery was
     * gated on `order.productKind`, which is the *header* column set from the
     * first line only. Buy a mug and a PDF and the header said "physical", so
     * the files never released.
     */
    const shop = await withRail();
    const mug = await makeProduct(shop.id, { title: "Mug", priceCents: 1500 });
    const pdf = await makeDigitalProduct(shop.id, { title: "Guide", priceCents: 900 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [
        { productId: mug.id, quantity: 1 },
        { productId: pdf.id, quantity: 2 },
      ],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = await orderRow(r.orderId);
    expect(o?.downloadToken).toBeTruthy();
    expect(o?.totalCents).toBe(1500 + 1800);
    expect(await db.select().from(orderItems).where(eq(orderItems.orderId, r.orderId))).toHaveLength(2);
  });
});

describe("coupons", () => {
  async function shopWithCoupon(over: Partial<typeof coupons.$inferInsert> = {}) {
    const shop = await withRail();
    await db.insert(coupons).values({
      shopId: shop.id,
      code: "HALF",
      discountType: "percent",
      discountValue: 5000,
      isActive: true,
      ...over,
    });
    return shop;
  }

  it("discounts the order", async () => {
    const shop = await shopWithCoupon();
    const p = await makeProduct(shop.id, { priceCents: 10_000 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      couponCode: "HALF",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await orderRow(r.orderId))?.discountCents).toBe(5000);
  });

  it("cannot spend a one-use code twice", async () => {
    const shop = await shopWithCoupon({ maxRedemptions: 1 });
    const p = await makeProduct(shop.id, { priceCents: 10_000 });
    const place = () =>
      createOrderIntent({
        shopId: shop.id,
        items: [{ productId: p.id, quantity: 1 }],
        paymentMethod: "cod",
        couponCode: "HALF",
        ...buyer,
      });

    const first = await place();
    expect(first.ok).toBe(true);
    const second = await place();
    const discount = second.ok ? (await orderRow(second.orderId))?.discountCents : 0;
    expect(discount).toBe(0);
  });

  it("cannot spend a one-use code twice concurrently", async () => {
    // The cap lives in the WHERE of the claim, which is why this holds.
    const shop = await shopWithCoupon({ maxRedemptions: 1 });
    const p = await makeProduct(shop.id, { priceCents: 10_000 });
    const both = await Promise.all(
      [1, 2].map((n) =>
        createOrderIntent({
          shopId: shop.id,
          items: [{ productId: p.id, quantity: 1 }],
          paymentMethod: "cod",
          couponCode: "HALF",
          ...buyer,
          customerEmail: `coupon-racer${n}@example.com`,
        }),
      ),
    );
    const discounts = await Promise.all(
      both.map(async (r) => (r.ok ? ((await orderRow(r.orderId))?.discountCents ?? 0) : 0)),
    );
    expect(discounts.filter((d) => d > 0)).toHaveLength(1);
  });

  it("ignores an unknown code", async () => {
    const shop = await shopWithCoupon();
    const p = await makeProduct(shop.id, { priceCents: 10_000 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      couponCode: "NOPE",
      ...buyer,
    });
    const discount = r.ok ? (await orderRow(r.orderId))?.discountCents : 0;
    expect(discount).toBe(0);
  });

  it("ignores another shop's code", async () => {
    const theirs = await makeShop();
    await db.insert(coupons).values({
      shopId: theirs.id,
      code: "OTHERS",
      discountType: "percent",
      discountValue: 9000,
      isActive: true,
    });
    const mine = await withRail();
    const p = await makeProduct(mine.id, { priceCents: 10_000 });
    const r = await createOrderIntent({
      shopId: mine.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      couponCode: "OTHERS",
      ...buyer,
    });
    const discount = r.ok ? (await orderRow(r.orderId))?.discountCents : 0;
    expect(discount).toBe(0);
  });
});

describe("cancellation and abandonment", () => {
  it("puts the units back, once", async () => {
    const shop = await withRail();
    const p = await makeProduct(shop.id, { trackInventory: true, stockQuantity: 5 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 2 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await stockOf(p.id)).toBe(3);

    const order = await orderRow(r.orderId);
    if (!order) throw new Error("the order that was just placed cannot be read");
    expect(await restoreStock(order)).toBe(true);
    expect(await stockOf(p.id)).toBe(5);

    // `restockedAt` is claimed in the statement that reads it, so a seller
    // clicking twice cannot inflate the shelf.
    expect(await restoreStock(order)).toBe(false);
    expect(await stockOf(p.id)).toBe(5);
  });

  it("releases stock and coupon together, once", async () => {
    const shop = await withRail();
    await db.insert(coupons).values({
      shopId: shop.id,
      code: "ONCE",
      discountType: "percent",
      discountValue: 1000,
      isActive: true,
      maxRedemptions: 1,
    });
    const p = await makeProduct(shop.id, { trackInventory: true, stockQuantity: 4 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      couponCode: "ONCE",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const order = await orderRow(r.orderId);
    if (!order) throw new Error("the order that was just placed cannot be read");
    expect(await abandonOrder(order)).toBe(true);
    expect(await stockOf(p.id)).toBe(4);

    // The coupon is spendable again, which is the half that used to be missed.
    const coupon = await db.query.coupons.findFirst({
      where: eq(coupons.shopId, shop.id),
    });
    expect(coupon?.timesRedeemed).toBe(0);

    expect(await abandonOrder(order)).toBe(false);
    expect(await stockOf(p.id)).toBe(4);
  });

  it("sweeps without error", async () => {
    const shop = await withRail();
    const result = await releaseAbandonedCheckouts({ shopId: shop.id });
    expect(typeof result.swept).toBe("number");
  });
});

describe("the storefront survives a hostile query string", () => {
  /*
   * `?sort=toString` was an unauthenticated 500 on every storefront in the
   * fleet. The sort map was an object literal indexed by a client-supplied
   * key, and an object literal inherits from `Object.prototype` — so the
   * lookup returned a *function*, `??` never fired, and spreading it threw.
   */
  it.each([
    "toString",
    "constructor",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "__proto__",
    "propertyIsEnumerable",
  ])("does not throw on ?sort=%s", async (sort) => {
    const shop = await withRail();
    await makeProduct(shop.id, { priceCents: 1000 });
    const { getPublicProducts } = await import("@/lib/queries/products");

    const page = await getPublicProducts(shop.id, shop.currency, { sort } as never);
    expect(page.items.length).toBeGreaterThan(0);
  });

  it("still honours the sorts that are real", async () => {
    const shop = await withRail();
    await makeProduct(shop.id, { title: "Cheap", priceCents: 100 });
    await makeProduct(shop.id, { title: "Dear", priceCents: 9000 });
    const { getPublicProducts } = await import("@/lib/queries/products");

    const asc = await getPublicProducts(shop.id, shop.currency, { sort: "price_asc" } as never);
    expect(asc.items[0]?.title).toBe("Cheap");
    const desc = await getPublicProducts(shop.id, shop.currency, { sort: "price_desc" } as never);
    expect(desc.items[0]?.title).toBe("Dear");
  });
});

describe("the quote and the order agree", () => {
  /*
   * A buyer must be charged the total they were shown. Rounding for the
   * three-decimal currencies was added to the committing path and not to
   * `previewOrder`, so a KWD shopper saw one total in the basket, qualified a
   * coupon against it, and was charged another. Both paths start from
   * `resolveLines`, which is where the rounding lives now — this asserts the
   * two cannot drift apart again.
   */
  it.each(["KWD", "BHD", "JOD", "USD", "JPY"])(
    "quotes in %s the amount it then charges",
    async (currency) => {
      const shop = await withRail({ currency });
      // A price that is not a multiple of ten, which is the whole difficulty.
      const product = await makeProduct(shop.id, { priceCents: 12_345 });

      const { previewOrder } = await import("@/lib/actions/order-preview");
      const quoted = await previewOrder({
        shopId: shop.id,
        items: [{ productId: product.id, quantity: 1 }],
      } as never);
      if ("error" in quoted) throw new Error(`preview failed: ${quoted.error}`);

      const placed = await createOrderIntent({
        shopId: shop.id,
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: "cod",
        ...buyer,
        customerEmail: `quote-${currency}@example.com`,
      });
      expect(placed.ok, placed.ok ? "" : placed.error).toBe(true);
      if (!placed.ok) return;

      const order = await orderRow(placed.orderId);
      expect(order?.totalCents, currency).toBe(quoted.totals.totalCents);
    },
  );
});

describe("bookings", () => {
  /*
   * The last check-then-act on the money path. `busyFor` decides which times a
   * shop may offer, and that decision is a read — so two buyers asking for the
   * same slot in the same second both saw it free, both passed the
   * re-derivation, and the shop owed one appointment to two people with
   * nothing anywhere to notice. Stock and coupons had claims; bookings did not.
   */
  const TIMES = { timeZone: "UTC", bookingSlotMinutes: 60 };

  async function bookableShop() {
    const shop = await withRail({
      ...TIMES,
      /*
       * Seven day-arrays indexed Sunday-first, which is what `WeeklyHours` is
       * — not an object keyed by day name. Open every day so the fixture does
       * not depend on which day it happens to run.
       */
      bookingHours: Array.from({ length: 7 }, () => [
        { from: "09:00", to: "17:00" },
      ]) as never,
    });
    const product = await makeProduct(shop.id, {
      kind: "service",
      bookingEnabled: true,
      durationMinutes: 60,
      bookingLeadHours: 0,
      priceCents: 5000,
    });
    return { shop, product };
  }

  /** The next 10:00 UTC that is at least a day out, so lead time never bites. */
  function slotIso(daysAhead = 2) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysAhead);
    d.setUTCHours(10, 0, 0, 0);
    return d.toISOString();
  }

  it("takes a booking and records the time", async () => {
    const { shop, product } = await bookableShop();
    const when = slotIso();
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, scheduledFor: when }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;

    const [line] = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, r.orderId));
    expect(line?.scheduledFor?.toISOString()).toBe(when);
  });

  it("refuses a second buyer the same slot", async () => {
    const { shop, product } = await bookableShop();
    const when = slotIso(3);

    const first = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, scheduledFor: when }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(first.ok).toBe(true);

    const second = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, scheduledFor: when }],
      paymentMethod: "cod",
      ...buyer,
      customerEmail: "second@example.com",
    });
    expect(second.ok).toBe(false);
  });

  it("refuses two buyers racing for the same slot", async () => {
    // The one a sequential test cannot see, and the reason the claim exists.
    const { shop, product } = await bookableShop();
    const when = slotIso(4);

    const both = await Promise.all(
      [1, 2].map((n) =>
        createOrderIntent({
          shopId: shop.id,
          items: [{ productId: product.id, quantity: 1, scheduledFor: when }],
          paymentMethod: "cod",
          ...buyer,
          customerEmail: `racer-slot${n}@example.com`,
        }),
      ),
    );
    expect(both.filter((r) => r.ok)).toHaveLength(1);
  });

  it("gives the slot back when the order is cancelled", async () => {
    const { shop, product } = await bookableShop();
    const when = slotIso(5);

    const first = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, scheduledFor: when }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const order = await orderRow(first.orderId);
    if (!order) throw new Error("the order that was just placed cannot be read");
    /*
     * Both halves, because that is what cancelling actually is. `restoreStock`
     * releases the claim, but `busyFor` also reads `order_items` joined to a
     * *live* order — so an order whose stock came back while its status stayed
     * `new` still holds its time, and correctly so. `updateOrderStatus` does
     * both; a test that did only one was testing a state the product never
     * reaches.
     */
    await db
      .update(orders)
      .set({ status: "cancelled" })
      .where(eq(orders.id, order.id));
    await restoreStock(order);

    // Somebody else can now have the time, which is what "cancelled releases
    // the slot" has to mean if the calendar is to be trusted.
    const second = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, scheduledFor: when }],
      paymentMethod: "cod",
      ...buyer,
      customerEmail: "after-cancel@example.com",
    });
    expect(second.ok, second.ok ? "" : second.error).toBe(true);
  });

  it("refuses an appointment that overlaps one already taken", async () => {
    /*
     * A unique index on the start time is not enough. A shop can offer a
     * 60-minute service on the half hour, so 09:00–10:00 and 09:30–10:30 are
     * both offerable starts — different rows, overlapping appointments, and
     * one of them the shop cannot keep. The exclusion constraint compares
     * ranges rather than instants, which is what makes the second lose.
     */
    const shop = await withRail({
      ...TIMES,
      bookingSlotMinutes: 30,
      bookingHours: Array.from({ length: 7 }, () => [
        { from: "09:00", to: "17:00" },
      ]) as never,
    });
    const product = await makeProduct(shop.id, {
      kind: "service",
      bookingEnabled: true,
      durationMinutes: 60,
      bookingLeadHours: 0,
      priceCents: 5000,
    });

    const at = (hours: number, minutes: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 9);
      d.setUTCHours(hours, minutes, 0, 0);
      return d.toISOString();
    };

    const first = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, scheduledFor: at(10, 0) }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(first.ok, first.ok ? "" : first.error).toBe(true);

    // Half an hour later: a different start, the same hour of the shop's time.
    const overlapping = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, scheduledFor: at(10, 30) }],
      paymentMethod: "cod",
      ...buyer,
      customerEmail: "overlap@example.com",
    });
    expect(overlapping.ok).toBe(false);
  });

  it("still allows a back-to-back appointment", async () => {
    // The range is half-open, so one ending at 10:00 and one starting at 10:00
    // do not collide — back-to-back is the normal case for a service business.
    const { shop, product } = await bookableShop();
    const at = (hours: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 10);
      d.setUTCHours(hours, 0, 0, 0);
      return d.toISOString();
    };

    const first = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, scheduledFor: at(10) }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(first.ok, first.ok ? "" : first.error).toBe(true);

    const next = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, scheduledFor: at(11) }],
      paymentMethod: "cod",
      ...buyer,
      customerEmail: "back-to-back@example.com",
    });
    expect(next.ok, next.ok ? "" : next.error).toBe(true);
  });

  it("refuses one basket booking the same slot twice", async () => {
    const { shop, product } = await bookableShop();
    const when = slotIso(6);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [
        { productId: product.id, quantity: 1, scheduledFor: when },
        { productId: product.id, quantity: 1, scheduledFor: when },
      ],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(false);
  });

  /*
   * Reclaiming a calendar nobody paid for.
   *
   * A booking on a manual rail holds its slot through the exclusion
   * constraint, and nothing used to hand it back: the sweep matched `card`
   * only, so a shop's week could be made unbookable by placing transfers and
   * never paying. These pin both halves — that an unanswered booking is
   * eventually released, and the cases where releasing it would be wrong.
   */
  async function ageOrder(orderId: string, hours: number) {
    await db
      .update(orders)
      .set({ createdAt: new Date(Date.now() - hours * 60 * 60 * 1000) })
      .where(eq(orders.id, orderId));
  }

  async function bookCod(shopId: string, productId: string, when: string) {
    const r = await createOrderIntent({
      shopId,
      items: [{ productId, quantity: 1, scheduledFor: when }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) throw new Error("fixture: the booking was refused");
    return r.orderId;
  }

  async function claimCount(orderId: string) {
    const rows = await db
      .select()
      .from(bookingClaims)
      .where(eq(bookingClaims.orderId, orderId));
    return rows.length;
  }

  it("releases a booking nobody paid for or answered", async () => {
    const { shop, product } = await bookableShop();
    const when = slotIso(9);
    const orderId = await bookCod(shop.id, product.id, when);
    expect(await claimCount(orderId)).toBe(1);

    // Still inside the hold: the seller may yet be waiting on a transfer.
    await ageOrder(orderId, 40);
    await releaseAbandonedCheckouts({ shopId: shop.id });
    expect(await claimCount(orderId)).toBe(1);

    await ageOrder(orderId, 80);
    const result = await releaseAbandonedCheckouts({ shopId: shop.id });
    expect(result.orderIds).toContain(orderId);
    expect(await claimCount(orderId)).toBe(0);
    expect((await orderRow(orderId))?.status).toBe("cancelled");

    // The point of all of it: the hour is bookable again.
    const second = await bookCod(shop.id, product.id, when);
    expect(await claimCount(second)).toBe(1);
  });

  it("leaves a booking the seller confirmed alone", async () => {
    const { shop, product } = await bookableShop();
    const orderId = await bookCod(shop.id, product.id, slotIso(10));

    // The seller accepting the time is exactly the signal that this booking
    // is real, whatever it says about payment — a service paid on the day
    // lives here, and cancelling it would be the worst thing this can do.
    await db
      .update(orders)
      .set({ status: "confirmed" })
      .where(eq(orders.id, orderId));
    await ageOrder(orderId, 24 * 30);

    await releaseAbandonedCheckouts({ shopId: shop.id });
    expect(await claimCount(orderId)).toBe(1);
    expect((await orderRow(orderId))?.status).toBe("confirmed");
  });

  it("leaves a paid booking alone however long the seller takes", async () => {
    const { shop, product } = await bookableShop();
    const orderId = await bookCod(shop.id, product.id, slotIso(11));
    await db
      .update(orders)
      .set({ paymentStatus: "paid" })
      .where(eq(orders.id, orderId));
    await ageOrder(orderId, 24 * 30);

    await releaseAbandonedCheckouts({ shopId: shop.id });
    expect(await claimCount(orderId)).toBe(1);
    expect((await orderRow(orderId))?.status).toBe("new");
  });

  it("does not turn into an expiry on unpaid manual orders generally", async () => {
    // The original sweep leaves manual stock orders for the seller to judge,
    // and that reasoning is untouched: only a held slot is reclaimed here.
    const shop = await withRail();
    const p = await makeProduct(shop.id, { trackInventory: true, stockQuantity: 5 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 2 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    await ageOrder(r.orderId, 24 * 30);

    await releaseAbandonedCheckouts({ shopId: shop.id });
    expect((await orderRow(r.orderId))?.status).toBe("new");
    expect(await stockOf(p.id)).toBe(3);
  });
});

/**
 * Checkout compliance (spec 05): the terms gate and the consent record.
 *
 * Both switches are per-shop and default off, so the first thing worth proving
 * is that a shop which never opened the setting checks out exactly as it did
 * before. After that, the two rules that actually carry legal weight: the
 * server refuses without agreement no matter what the browser sent, and
 * consent is a timestamp that a later order can grant but never quietly erase.
 */
describe("checkout compliance", () => {
  const clientRow = (shopId: string) =>
    db.query.clients.findFirst({ where: eq(clients.shopId, shopId) });

  it("refuses the order when the shop requires terms and none were agreed", async () => {
    const shop = await withRail({ requireTerms: true });
    const p = await makeProduct(shop.id);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(false);
  });

  /*
   * The point of the gate sitting where it does. A refusal that happened after
   * the reservation would hold units for an order that never existed, and with
   * no order row the sweep has nothing to find and nothing hands them back.
   */
  it("takes nothing off the shelf for an order it refuses", async () => {
    const shop = await withRail({ requireTerms: true });
    const p = await makeProduct(shop.id, { trackInventory: true, stockQuantity: 5 });
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 2 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(false);
    expect(await stockOf(p.id)).toBe(5);
  });

  it("writes no buyer record for an order it refuses", async () => {
    const shop = await withRail({ requireTerms: true });
    const p = await makeProduct(shop.id);
    await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(await clientRow(shop.id)).toBeUndefined();
  });

  it("takes the order once agreed, and stamps when", async () => {
    const shop = await withRail({ requireTerms: true });
    const p = await makeProduct(shop.id);
    const before = new Date();
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      acceptedTerms: true,
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const accepted = (await orderRow(r.orderId))?.termsAcceptedAt;
    expect(accepted).toBeInstanceOf(Date);
    // The server's clock, so it cannot predate the call that produced it.
    expect(accepted?.getTime() ?? 0).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  /*
   * A shop that is not asking cannot accumulate proof of agreement to nothing.
   * The flag is in the request either way — a stale client, a copied script —
   * and the shop's own column is what decides.
   */
  it("records no agreement for a shop that never asked, whatever the request claims", async () => {
    const shop = await withRail();
    const p = await makeProduct(shop.id);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      acceptedTerms: true,
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await orderRow(r.orderId))?.termsAcceptedAt).toBeNull();
  });

  it("records consent with the moment it was given", async () => {
    const shop = await withRail({ askMarketingConsent: true });
    const p = await makeProduct(shop.id);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      marketingOptIn: true,
      ...buyer,
    });
    expect(r.ok).toBe(true);
    expect((await clientRow(shop.id))?.marketingConsentAt).toBeInstanceOf(Date);
  });

  it("leaves consent null when the box is left empty", async () => {
    const shop = await withRail({ askMarketingConsent: true });
    const p = await makeProduct(shop.id);
    await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect((await clientRow(shop.id))?.marketingConsentAt).toBeNull();
  });

  it("ignores an opt-in from a shop that never showed the box", async () => {
    const shop = await withRail();
    const p = await makeProduct(shop.id);
    await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      marketingOptIn: true,
      ...buyer,
    });
    expect((await clientRow(shop.id))?.marketingConsentAt).toBeNull();
  });

  /*
   * The fourth corner, which completes the pair of conditions rather than
   * repeating them.
   *
   * Consent is written when the shop asked *and* the buyer ticked; the three
   * tests above cover ticked-and-asked, asked-and-not-ticked, and
   * ticked-but-never-asked. Neither is the case nothing looks at, and it is
   * the one a `??` in the wrong place would quietly turn into a grant.
   */
  it("records nothing for a shop that never asked and a buyer who never ticked", async () => {
    const shop = await withRail();
    const p = await makeProduct(shop.id);
    await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect((await clientRow(shop.id))?.marketingConsentAt).toBeNull();
  });

  /*
   * The grant-only merge, which is the rule most easily lost in a refactor.
   *
   * The same buyer orders twice. The second time they skip the optional box —
   * which is what optional boxes are for — and their consent has to survive
   * it. Writing the second order's `null` over the first order's timestamp
   * would silently shrink the seller's lawful audience with every repeat
   * customer, and nothing anywhere would report it.
   */
  it("keeps consent granted by an earlier order when a later one omits it", async () => {
    const shop = await withRail({ askMarketingConsent: true });
    const p = await makeProduct(shop.id);

    const first = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      marketingOptIn: true,
      ...buyer,
    });
    expect(first.ok).toBe(true);
    const granted = (await clientRow(shop.id))?.marketingConsentAt;
    expect(granted).toBeInstanceOf(Date);

    const second = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(second.ok).toBe(true);

    const after = (await clientRow(shop.id))?.marketingConsentAt;
    expect(after).toBeInstanceOf(Date);
    // The original moment, not a refreshed one: consent was given once.
    expect(after?.getTime()).toBe(granted?.getTime());
  });

  it("carries the consent timestamp into the clients export", async () => {
    const shop = await withRail({ askMarketingConsent: true });
    const p = await makeProduct(shop.id);
    await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      marketingOptIn: true,
      ...buyer,
    });

    const csv = await exportClients(shop.id, shop.currency);
    expect(csv).toContain("Marketing Consent At");

    const consented = (await clientRow(shop.id))?.marketingConsentAt;
    expect(consented).toBeInstanceOf(Date);
    // The seller downloads the proof, not just the address.
    expect(csv).toContain(String(consented?.getFullYear()));
  });

  it("leaves the export column blank for a buyer who never opted in", async () => {
    const shop = await withRail({ askMarketingConsent: true });
    const p = await makeProduct(shop.id);
    await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });

    const csv = await exportClients(shop.id, shop.currency);
    /*
     * Read by header rather than by position.
     *
     * This asserted that the row ended with a comma, which only held while
     * `Marketing Consent At` happened to be the last column — so appending
     * `Tags` and `Source` to the export broke a test about consent for
     * reasons that had nothing to do with consent. Naming the column is what
     * makes the assertion survive the next one.
     */
    const [header, ...rows] = csv.trim().split("\n");
    const at = (header ?? "").split(",").indexOf("Marketing Consent At");
    expect(at).toBeGreaterThan(-1);

    // Blank means never opted in, which is not the same as opted out and must
    // not arrive as a date. None of the fixture's values contain a comma, so
    // a plain split is enough to index the row.
    expect((rows.at(-1) ?? "").split(",")[at]).toBe("");
  });
});
