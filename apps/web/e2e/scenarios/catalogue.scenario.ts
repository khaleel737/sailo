import { beforeAll, describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  invoices,
  offerEvents,
  offers,
  orderItems,
  orders,
  paymentMethods,
  productVariants,
  products,
  shops,
  stockRequests,
  subscriptions,
  user,
} from "@sailo/db/schema";
import { createOrderIntent } from "@/lib/actions/orders";
import { previewOrder } from "@/lib/actions/order-preview";
import { requestStock, claimStockNotifications } from "@sailo/commerce/catalog";
import { recordShipment, shipmentsForOrder } from "@sailo/commerce/orders/server";
import { takeOffer } from "@sailo/commerce/orders/server";

/**
 * Wave B's money paths, against a database we are allowed to dirty.
 *
 * Everything here is a rule that a unit test can only assert *about a mock*:
 * a clamp applied at both sinks, a claim under concurrency, a ceiling counted
 * across rows, a status derived from coverage. `PRODUCTION-PLAN.md` records
 * four defects found by writing scenarios like these and none found by reading,
 * which is why spec 43 and spec 51 both say money-path changes need scenario
 * coverage rather than unit coverage.
 *
 *   ./e2e/scenarios/up.sh
 *   npx vitest run --config vitest.scenarios.mts e2e/scenarios/catalogue.scenario.ts
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
      /*
       * `plan` alone is not entitlement, and leaving this out cost a test.
       *
       * `planFor` reads both columns and falls back to Free without a status —
       * so a shop marked `business` with no subscription has `memberships:
       * false`, and `resolveOrderIntent` refuses the membership with the same
       * sentence it uses for a rail that does not exist. The fixture has to say
       * what the checkout actually asks.
       */
      subscriptionStatus: "active",
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");

  /*
   * Two rails, because the shop needs both and the difference is load-bearing.
   *
   * `cod` promises a moment where money changes hands, so `cartCanPayInPerson`
   * refuses it for a basket holding anything that never reaches a doorstep — a
   * download, an online call. That is correct and it caught a fixture in this
   * file: the free-download test was written against `cod` and the checkout was
   * right to refuse it.
   */
  await db.insert(paymentMethods).values([
    {
      shopId: shop.id,
      type: "cod",
      label: "Cash on delivery",
      config: {} as never,
      isEnabled: true,
      position: 0,
    },
    {
      shopId: shop.id,
      type: "bank_transfer",
      label: "Bank transfer",
      config: {
        bankName: "Test Bank",
        accountName: "Checkout Ltd",
        accountNumber: "12345678",
      } as never,
      isEnabled: true,
      position: 1,
    },
  ]);
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
      priceCents: 2000,
      isPublished: true,
      inStock: true,
      ...over,
    })
    .returning();
  if (!p) throw new Error("fixture: product was not inserted");
  return p;
}

beforeAll(() => {
  assertLocalDatabase();
});

/* ========================================================================== */
/*  Spec 43 — pay what you want                                               */
/* ========================================================================== */

describe("a price the buyer names", () => {
  it("charges what they entered, and clamps a forged lower one at both sinks", async () => {
    /*
     * The whole security content of the feature, exercised where it counts.
     *
     * A unit test can prove `clampPwywCents` floors a number. Only this can
     * prove that the *quote* and the *charge* apply the same floor — which is
     * the recurring "guard applied at one sink not its twin" shape, and the one
     * that costs money directly.
     */
    const shop = await makeShop();
    const product = await makeProduct(shop.id, {
      pricingMode: "pwyw",
      minPriceCents: 1500,
      suggestedPriceCents: 2500,
    });

    const honest = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, priceCents: 4000 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(honest.ok).toBe(true);
    if (honest.ok) expect(honest.totals.totalCents).toBe(4000);

    const forged = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, priceCents: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(forged.ok).toBe(true);
    if (forged.ok) expect(forged.totals.totalCents).toBe(1500);

    // And the basket says the same thing before the buyer commits — the twin.
    const quoted = await previewOrder({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, priceCents: 1 }],
    });
    expect("error" in quoted).toBe(false);
    if (!("error" in quoted)) expect(quoted.totals.totalCents).toBe(1500);
  });

  it("takes the free path for a zero-floor order and creates no charge", async () => {
    // A donation somebody took for nothing. `paymentStatus` is `paid` because
    // nothing is owed — and because the 24-hour sweep only takes *unpaid* card
    // orders, so leaving it `unpaid` would have it cancelled the next day.
    const shop = await makeShop();
    const product = await makeProduct(shop.id, {
      kind: "digital",
      pricingMode: "pwyw",
      minPriceCents: 0,
      suggestedPriceCents: 500,
    });

    const free = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1, priceCents: 0 }],
      // Not `cod`: a download never reaches a doorstep, so there is no moment
      // to collect cash at and `cartCanPayInPerson` refuses the rail.
      paymentMethod: "bank_transfer",
      ...buyer,
    });
    expect(free.ok).toBe(true);
    if (!free.ok) return;

    expect(free.totals.totalCents).toBe(0);
    const [row] = await db
      .select({ status: orders.paymentStatus })
      .from(orders)
      .where(eq(orders.id, free.orderId));
    expect(row?.status).toBe("paid");

    // A free sale is still a sale, so it still gets a receipt.
    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.orderId, free.orderId),
    });
    expect(invoice).toBeTruthy();
  });

  it("refuses a product outside its window, even from a page opened earlier", async () => {
    /*
     * The rule that makes hiding the button insufficient. A cached page never
     * expires on a clock (`cacheLife("max")`), and the checkout is a server
     * action a browser can call directly — so the refusal has to be here.
     */
    const shop = await makeShop();
    const closed = await makeProduct(shop.id, {
      sellUntil: new Date(Date.now() - 60_000),
    });
    const unopened = await makeProduct(shop.id, {
      sellFrom: new Date(Date.now() + 86_400_000),
    });

    const late = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: closed.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(late.ok).toBe(false);

    const early = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: unopened.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(early.ok).toBe(false);
    // Two different sentences: something not released yet is worth waiting for.
    if (!late.ok && !early.ok) expect(late.error).not.toBe(early.error);
  });
});

/* ========================================================================== */
/*  Spec 33 — back in stock, and preorders                                    */
/* ========================================================================== */

describe("the back-in-stock queue", () => {
  it("notifies the variant that came back and leaves the other untouched", async () => {
    /*
     * The failure this whole feature is shaped to prevent: telling somebody
     * about the red one when they asked about the blue.
     */
    const shop = await makeShop();
    const product = await makeProduct(shop.id, { trackInventory: true });
    const [blue] = await db
      .insert(productVariants)
      .values({ productId: product.id, options: { Colour: "Blue" }, stockQuantity: 0 })
      .returning();
    const [red] = await db
      .insert(productVariants)
      .values({ productId: product.id, options: { Colour: "Red" }, stockQuantity: 0 })
      .returning();
    if (!blue || !red) throw new Error("fixture: variants were not inserted");

    await requestStock({
      shopId: shop.id,
      productId: product.id,
      variantId: blue.id,
      email: "blue@example.com",
    });
    await requestStock({
      shopId: shop.id,
      productId: product.id,
      variantId: red.id,
      email: "red@example.com",
    });

    const claimed = await claimStockNotifications(product.id, blue.id);
    expect(claimed.map((r) => r.email)).toEqual(["blue@example.com"]);

    const stillOwed = await db.query.stockRequests.findMany({
      where: and(
        eq(stockRequests.productId, product.id),
        sql`${stockRequests.notifiedAt} is null`,
      ),
    });
    expect(stillOwed.map((r) => r.email)).toEqual(["red@example.com"]);
  });

  it("tells each contact once, however many restocks follow", async () => {
    // A seller who restocks Monday, sells out by lunch and restocks Wednesday
    // must not message the same person twice in three days.
    const shop = await makeShop();
    const product = await makeProduct(shop.id, { trackInventory: true });

    await requestStock({
      shopId: shop.id,
      productId: product.id,
      email: "once@example.com",
    });

    const first = await claimStockNotifications(product.id, null);
    const second = await claimStockNotifications(product.id, null);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("holds one open request per contact per variant, under a null variant", async () => {
    /*
     * `NULLS NOT DISTINCT` is what makes this pass. Under the default rule
     * `variant_id` being null makes every row distinct, so the same address
     * could be registered a thousand times against one mug.
     */
    const shop = await makeShop();
    const product = await makeProduct(shop.id);

    for (let i = 0; i < 3; i++) {
      await requestStock({
        shopId: shop.id,
        productId: product.id,
        email: "dup@example.com",
      });
    }

    const rows = await db.query.stockRequests.findMany({
      where: eq(stockRequests.productId, product.id),
    });
    expect(rows).toHaveLength(1);
  });

  it("answers identically for a real and an invented variant id", async () => {
    // No response may be an existence oracle. Both write nothing the caller can
    // distinguish, and neither throws.
    const shop = await makeShop();
    const product = await makeProduct(shop.id);

    await expect(
      requestStock({
        shopId: shop.id,
        productId: product.id,
        variantId: uid(),
        email: "invented@example.com",
      }),
    ).resolves.toBeUndefined();

    await expect(
      requestStock({
        shopId: shop.id,
        productId: uid(),
        email: "nothing@example.com",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("preorders", () => {
  it("places an ordinary order with no stock movement, carrying the promised date", async () => {
    const shop = await makeShop();
    const expected = new Date("2026-12-01T00:00:00Z");
    const product = await makeProduct(shop.id, {
      trackInventory: true,
      stockQuantity: 0,
      preorderEnabled: true,
      preorderExpectedAt: expected,
    });

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const [row] = await db
      .select({
        isPreorder: orders.isPreorder,
        promised: orders.preorderExpectedAt,
      })
      .from(orders)
      .where(eq(orders.id, placed.orderId));
    expect(row?.isPreorder).toBe(true);
    expect(row?.promised?.toISOString()).toBe(expected.toISOString());

    // Nothing came off a shelf that had nothing on it. A preorder line takes no
    // units, so it must not "return" any either.
    const [after] = await db
      .select({ stock: products.stockQuantity })
      .from(products)
      .where(eq(products.id, product.id));
    expect(after?.stock).toBe(0);
  });

  it("refuses the n+1th under concurrency, counting each order's own row", async () => {
    /*
     * The claim, and the reason it is re-taken *after* the insert: the cheap
     * check before it reads the same count for every simultaneous buyer. Here
     * each order is inside the count that refuses it, so of any burst exactly
     * `limit` survive.
     */
    const shop = await makeShop();
    const product = await makeProduct(shop.id, {
      trackInventory: true,
      stockQuantity: 0,
      preorderEnabled: true,
      preorderLimit: 2,
    });

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        createOrderIntent({
          shopId: shop.id,
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethod: "cod",
          ...buyer,
        }),
      ),
    );

    const kept = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.shopId, shop.id), eq(orders.isPreorder, true)));

    expect(kept.length).toBeLessThanOrEqual(2);
    expect(results.filter((r) => r.ok).length).toBe(kept.length);
  });

  it("still refuses a sold-out product that does not take preorders", async () => {
    const shop = await makeShop();
    const product = await makeProduct(shop.id, {
      trackInventory: true,
      stockQuantity: 0,
    });

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(placed.ok).toBe(false);
  });
});

/* ========================================================================== */
/*  Spec 51 — shipments                                                       */
/* ========================================================================== */

describe("an order that goes out in two boxes", () => {
  it("is completed only on the second, and keeps the first tracking number", async () => {
    const shop = await makeShop();
    const mug = await makeProduct(shop.id, { title: "Mug" });
    const towel = await makeProduct(shop.id, { title: "Towel" });

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [
        { productId: mug.id, quantity: 2 },
        { productId: towel.id, quantity: 1 },
      ],
      paymentMethod: "cod",
      ...buyer,
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const lines = await db.query.orderItems.findMany({
      where: eq(orderItems.orderId, placed.orderId),
    });
    const mugLine = lines.find((l) => l.productId === mug.id);
    const towelLine = lines.find((l) => l.productId === towel.id);
    if (!mugLine || !towelLine) throw new Error("fixture: lines missing");

    const first = await recordShipment({
      shopId: shop.id,
      orderId: placed.orderId,
      carrier: "Royal Mail",
      trackingNumber: "AAA111",
      items: [{ orderItemId: mugLine.id, quantity: 2 }],
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.complete).toBe(false);

    const midway = await db.query.orders.findFirst({
      where: eq(orders.id, placed.orderId),
    });
    expect(midway?.status).toBe("shipped");
    expect(midway?.trackingNumber).toBe("AAA111");

    const second = await recordShipment({
      shopId: shop.id,
      orderId: placed.orderId,
      carrier: "Royal Mail",
      trackingNumber: "BBB222",
      items: [{ orderItemId: towelLine.id, quantity: 1 }],
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.complete).toBe(true);

    const done = await db.query.orders.findFirst({
      where: eq(orders.id, placed.orderId),
    });
    expect(done?.status).toBe("completed");
    /*
     * The header keeps the *first* shipment's number. The buyer was emailed
     * that one, and their link must not start resolving to a different parcel.
     */
    expect(done?.trackingNumber).toBe("AAA111");

    const state = await shipmentsForOrder(placed.orderId);
    expect(state.shipments).toHaveLength(2);
  });

  it("refuses more of a line than the order holds", async () => {
    // The seller's screen is a snapshot — two tabs on one order both render a
    // remainder that was true when they loaded. Coverage decides `completed`,
    // so an over-ship marks a half-shipped order finished.
    const shop = await makeShop();
    const mug = await makeProduct(shop.id);

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: mug.id, quantity: 2 }],
      paymentMethod: "cod",
      ...buyer,
    });
    if (!placed.ok) throw new Error("fixture: order was not placed");

    const [line] = await db.query.orderItems.findMany({
      where: eq(orderItems.orderId, placed.orderId),
    });
    if (!line) throw new Error("fixture: line missing");

    const over = await recordShipment({
      shopId: shop.id,
      orderId: placed.orderId,
      items: [{ orderItemId: line.id, quantity: 5 }],
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe("over_shipped");
  });
});

/* ========================================================================== */
/*  Specs 36 and 08 — offers                                                  */
/* ========================================================================== */

describe("offers", () => {
  it("takes an offer once, however many times the button is pressed", async () => {
    /*
     * One-click means double-click. The claim is a partial unique index on
     * (offer, order) for `taken`, and this is the only place it can be proved:
     * a mock cannot race itself.
     */
    const shop = await makeShop();
    const source = await makeProduct(shop.id, { title: "Mug" });
    const extra = await makeProduct(shop.id, { title: "Lid" });

    const [offer] = await db
      .insert(offers)
      .values({
        shopId: shop.id,
        placement: "crosssell",
        sourceProductId: source.id,
        offerProductId: extra.id,
        priceCents: 500,
      })
      .returning();
    if (!offer) throw new Error("fixture: offer was not inserted");

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: source.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    if (!placed.ok) throw new Error("fixture: order was not placed");

    const taps = await Promise.all(
      Array.from({ length: 5 }, () =>
        takeOffer({
          shopId: shop.id,
          offerId: offer.id,
          orderId: placed.orderId,
          now: new Date(),
        }),
      ),
    );
    expect(taps.filter((t) => t.ok)).toHaveLength(1);

    const claims = await db.query.offerEvents.findMany({
      where: and(eq(offerEvents.offerId, offer.id), eq(offerEvents.outcome, "taken")),
    });
    expect(claims).toHaveLength(1);
  });

  it("refuses an expired offer at the claim, not only at render", async () => {
    // Theirs is explicit: a buyer who opens a time-limited offer must not be
    // able to complete it once it expires, even with the page still open.
    const shop = await makeShop();
    const source = await makeProduct(shop.id);
    const extra = await makeProduct(shop.id, { title: "Lid" });

    const [offer] = await db
      .insert(offers)
      .values({
        shopId: shop.id,
        placement: "crosssell",
        offerProductId: extra.id,
        validUntil: new Date(Date.now() - 60_000),
      })
      .returning();
    if (!offer) throw new Error("fixture: offer was not inserted");

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: source.id, quantity: 1 }],
      paymentMethod: "cod",
      ...buyer,
    });
    if (!placed.ok) throw new Error("fixture: order was not placed");

    const late = await takeOffer({
      shopId: shop.id,
      offerId: offer.id,
      orderId: placed.orderId,
      now: new Date(),
    });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toBe("expired");

    // And it is written down, so a seller can see a window they set too tight.
    const events = await db.query.offerEvents.findMany({
      where: and(eq(offerEvents.offerId, offer.id), eq(offerEvents.outcome, "expired")),
    });
    expect(events).toHaveLength(1);
  });

  it("attributes a bump line server-side, and never the source's own", async () => {
    // A client flag saying "this line was a bump" is a client telling us its
    // own conversion rate.
    const shop = await makeShop();
    const source = await makeProduct(shop.id, { title: "Mug" });
    const extra = await makeProduct(shop.id, { title: "Lid", priceCents: 500 });

    const [offer] = await db
      .insert(offers)
      .values({
        shopId: shop.id,
        placement: "bump",
        sourceProductId: source.id,
        offerProductId: extra.id,
      })
      .returning();
    if (!offer) throw new Error("fixture: offer was not inserted");

    const placed = await createOrderIntent({
      shopId: shop.id,
      items: [
        { productId: source.id, quantity: 1 },
        { productId: extra.id, quantity: 1 },
      ],
      paymentMethod: "cod",
      ...buyer,
    });
    if (!placed.ok) throw new Error("fixture: order was not placed");

    const lines = await db.query.orderItems.findMany({
      where: eq(orderItems.orderId, placed.orderId),
    });
    const bumped = lines.find((l) => l.productId === extra.id);
    const origin = lines.find((l) => l.productId === source.id);

    expect(bumped?.viaBump).toBe(true);
    expect(bumped?.viaOfferId).toBe(offer.id);
    // The line that *triggered* the bump is not itself a bump.
    expect(origin?.viaBump).toBe(false);
  });
});

/* ========================================================================== */
/*  Spec 43 — a manual trial                                                  */
/* ========================================================================== */

describe("a free trial on a rail Sailo runs itself", () => {
  it("writes a zero-value signup with no invoice, and opens the membership", async () => {
    /*
     * The trap the spec names: a zero-value signup order must not enter the
     * invoice sequence. A gap in a sequence a tax authority expects unbroken is
     * not recoverable, and the document would read "total 0.00".
     */
    const shop = await makeShop();
    const membership = await makeProduct(shop.id, {
      kind: "membership",
      title: "Gym month",
      priceCents: 3000,
      billingInterval: "month",
      trialDays: 14,
    });

    const signup = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: membership.id, quantity: 1 }],
      paymentMethod: "bank_transfer",
      ...buyer,
    });
    expect(signup.ok).toBe(true);
    if (!signup.ok) return;

    expect(signup.totals.totalCents).toBe(0);

    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.orderId, signup.orderId),
    });
    expect(invoice).toBeUndefined();

    // The door opens, and the subscription is worth the product's real price —
    // not the order's zero, which would ask the member for nothing for ever.
    const [order] = await db
      .select({ subscriptionId: orders.subscriptionId })
      .from(orders)
      .where(eq(orders.id, signup.orderId));
    expect(order?.subscriptionId).toBeTruthy();

    const row = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, order!.subscriptionId!),
    });
    expect(row?.status).toBe("trialing");
    expect(row?.priceCents).toBe(3000);
    expect(row?.currentPeriodEnd).toBeTruthy();
  });
});
