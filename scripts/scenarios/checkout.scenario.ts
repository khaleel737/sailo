import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  coupons,
  deliveryMethods,
  orderItems,
  orders,
  paymentMethods,
  productFiles,
  products,
  shops,
  user,
} from "@/db/schema";
import { createOrderIntent } from "@/lib/actions/orders";
import { abandonOrder, releaseAbandonedCheckouts, restoreStock } from "@/lib/inventory";

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
 * `scripts/scenarios/up.sh` gives it somewhere safe to write. Run with:
 *
 *   ./scripts/scenarios/up.sh
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
    config: {} as never,
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
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("localhost")) {
    throw new Error(`scenario suite refused: DATABASE_URL is not local (${url.slice(0, 30)}…)`);
  }
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
    const shop = await withRail();
    const p = await makeDigitalProduct(shop.id);
    const r = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = await orderRow(r.orderId);
    expect(o?.downloadToken).toBeTruthy();
    expect(o?.downloadReleasedAt).toBeNull();
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
});
