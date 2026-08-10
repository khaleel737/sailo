import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { coupons, products, shops, user } from "@/db/schema";
import { previewOrder } from "@/lib/actions/order-preview";
import { eq } from "drizzle-orm";
import { assertLocalDatabase } from "./local-only";

/**
 * The coupon ceiling, against a real Redis rather than a mocked one.
 *
 * The shape assertions in `throttled-answers.test.ts` pin which branch the
 * code takes. This asks the question a buyer would: quote the same working
 * code far more times than the ceiling allows, and check the discount is still
 * there at the end.
 *
 * That is the exact regression the first version of this limit shipped —
 * charging every lookup meant a code sitting in the basket burned the budget
 * on its own, through nothing but re-pricing, and then came back `not_found`
 * while the buyer was part-way through checkout.
 *
 * Skipped unless `SCENARIO_REDIS_URL` is set, because with no backend the
 * limiter fails open and this would pass without exercising anything:
 *
 *   docker run -d --name sailo-test-redis -p 63790:6379 redis:7-alpine
 *   SCENARIO_REDIS_URL=redis://localhost:63790 \
 *     npx vitest run --config vitest.scenarios.mts scripts/scenarios/coupon-budget.scenario.ts
 *
 * **This file, not the whole suite.** The other scenarios place dozens of
 * orders a minute from one address, which is far past the ten `createOrderIntent`
 * allows — so with a live limiter they fail, and they fail by being correctly
 * throttled. That is the ceiling working. Point Redis at the files whose
 * subject is a ceiling and leave the rest failing open, which is why the
 * variable is opt-in rather than read from `.env.local`.
 */
const hasRedis = Boolean(process.env.SCENARIO_REDIS_URL);

describe.skipIf(!hasRedis)("the coupon budget", () => {
  async function shopWithCoupon() {
    const db = getDb();
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      name: "Coupon Seller",
      email: `coupon-${userId}@example.com`,
      emailVerified: true,
    });
    const [shop] = await db
      .insert(shops)
      .values({
        userId,
        handle: `coupon-${userId.slice(0, 8)}`,
        name: "Coupon Shop",
        currency: "USD",
        plan: "business",
        subscriptionStatus: "active",
        isPublished: true,
      })
      .returning();
    if (!shop) throw new Error("fixture: shop was not inserted");

    const [product] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Discounted Thing",
        slug: `d-${userId.slice(0, 8)}`,
        kind: "physical",
        priceCents: 10_000,
        isPublished: true,
        inStock: true,
      })
      .returning();
    if (!product) throw new Error("fixture: product was not inserted");

    await db.insert(coupons).values({
      shopId: shop.id,
      code: "SAVE10",
      discountType: "percent",
      discountValue: 1000,
      isActive: true,
    });

    return { shop, product, userId };
  }

  /*
   * In a `finally`, so a failed assertion tidies up too — a run that fails and
   * leaves its shop behind makes the *next* run harder to read, which is the
   * worst time for that. A failure inside the fixture itself can still leak
   * its partial rows; the database is a throwaway, so that trade stops here.
   */
  async function drop(shopId: string, userId: string) {
    const db = getDb();
    await db.delete(products).where(eq(products.shopId, shopId));
    await db.delete(coupons).where(eq(coupons.shopId, shopId));
    await db.delete(shops).where(eq(shops.id, shopId));
    await db.delete(user).where(eq(user.id, userId));
  }

  it("keeps applying a real code however often the basket re-prices", async () => {
    assertLocalDatabase();
    const { shop, product, userId } = await shopWithCoupon();

    try {
      // Well past the ceiling of ten. Every one of these is a legitimate
      // re-quote: the code is in the basket and the buyer edited something.
      const quotes = [];
      for (let i = 0; i < 25; i++) {
        quotes.push(
          await previewOrder({
            shopId: shop.id,
            items: [{ productId: product.id, quantity: 1 }],
            couponCode: "SAVE10",
          }),
        );
      }

      for (const [i, q] of quotes.entries()) {
        if ("error" in q) throw new Error(`quote ${i} failed: ${q.error}`);
        expect(q.couponApplied, `quote ${i} lost the discount`).toBe("SAVE10");
        expect(q.couponError, `quote ${i} reported an error`).toBeUndefined();
        expect(q.totals.discountCents).toBeGreaterThan(0);
      }
    } finally {
      await drop(shop.id, userId);
    }
  }, 120_000);

  it("still stops someone guessing codes that do not exist", async () => {
    assertLocalDatabase();
    const { shop, product, userId } = await shopWithCoupon();

    try {
      // Distinct wrong codes, which is what enumeration looks like. The
      // ceiling is ten in five minutes, so the run must end refused —
      // identically to a miss, saying nothing about which codes exist.
      //
      // Fired concurrently because that is the shape of the attack, not
      // because this test can see the difference: a burst ends with the
      // budget spent under either ordering, and what the peek version leaked
      // was the *lookups in between*, which no response reveals. The ordering
      // itself is pinned where it is visible — `throttled-answers.test.ts`
      // for the charge-before-lookup shape, `redis.test.ts` for the refund.
      await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          previewOrder({
            shopId: shop.id,
            items: [{ productId: product.id, quantity: 1 }],
            couponCode: `WRONG${i}`,
          }),
        ),
      );

      // The real code now misses too, because this address spent its budget
      // on guesses. That is the intended cost and it falls on the guesser.
      const after = await previewOrder({
        shopId: shop.id,
        items: [{ productId: product.id, quantity: 1 }],
        couponCode: "SAVE10",
      });
      if ("error" in after) throw new Error(after.error);
      expect(after.couponApplied).toBeUndefined();
    } finally {
      await drop(shop.id, userId);
    }
  }, 120_000);
});
