import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { orders, paymentMethods, products, shops, user } from "@/db/schema";
import { createOrderIntent } from "@/lib/actions/orders";
import { eq, sql } from "drizzle-orm";
import { assertLocalDatabase } from "./local-only";

/**
 * Sustained concurrent checkouts against one shop.
 *
 * The scenario suite proves a checkout is *correct*, including under two
 * buyers racing. This asks a different question: does it stay correct, and
 * stay up, when a hundred of them arrive at once — which is what a shop with a
 * popular link actually looks like.
 *
 * Stock is the assertion that matters. Every one of these is guarded by the
 * same conditional UPDATE, so the invariant is arithmetic: units sold plus
 * units left equals what was on the shelf. A single oversell fails it.
 */
describe("throughput", () => {
  it("holds under 120 concurrent checkouts without overselling", async () => {
    assertLocalDatabase();
    const db = getDb();
    const uid = () => crypto.randomUUID();
    const userId = uid();
    const STOCK = 80;
    const BUYERS = 120;

    await db.insert(user).values({
      id: userId,
      name: "Load Seller",
      email: `load-${userId.slice(0, 8)}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [shop] = await db
      .insert(shops)
      .values({
        userId,
        handle: `load-${userId.slice(0, 8)}`,
        name: "Load Shop",
        currency: "USD",
        isPublished: true,
        plan: "business",
        subscriptionStatus: "active",
      })
      .returning();
    if (!shop) throw new Error("fixture: no shop");

    await db.insert(paymentMethods).values({
      shopId: shop.id,
      type: "cod",
      label: "COD",
      config: {} as never,
      isEnabled: true,
      position: 0,
    });
    const [product] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Hot Item",
        slug: `hot-${userId.slice(0, 8)}`,
        kind: "physical",
        priceCents: 2500,
        isPublished: true,
        inStock: true,
        trackInventory: true,
        stockQuantity: STOCK,
      })
      .returning();
    if (!product) throw new Error("fixture: no product");

    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: BUYERS }, (_, i) =>
        createOrderIntent({
          shopId: shop.id,
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethod: "cod",
          customerName: `Buyer ${i}`,
          customerEmail: `load-buyer-${i}-${userId.slice(0, 8)}@example.com`,
          customerPhone: `+1555000${String(i).padStart(4, "0")}`,
          addressLine1: "1 High Street",
          city: "Leeds",
          postalCode: "LS1 1AA",
          country: "UK",
        }).catch((error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? `THREW: ${error.message}` : "THREW",
        })),
      ),
    );
    const seconds = (performance.now() - started) / 1000;

    const sold = results.filter((r) => r.ok).length;
    const threw = results.flatMap((r) =>
      !r.ok && r.error.startsWith("THREW") ? [r.error] : [],
    );
    const [stockRow] = await db
      .select({ left: products.stockQuantity })
      .from(products)
      .where(eq(products.id, product.id));
    const [countRow] = await db
      .select({ rows: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.shopId, shop.id));
    const left = stockRow?.left ?? 0;
    const orderRows = countRow?.rows ?? 0;

    console.log(
      `\n  ${BUYERS} concurrent · ${sold} sold · ${left} left · ` +
        `${seconds.toFixed(1)}s · ${(BUYERS / seconds).toFixed(0)}/s`,
    );
    writeFileSync(
      process.env.THROUGHPUT_OUT ?? "/tmp/throughput.txt",
      `${BUYERS} concurrent · ${sold} sold · ${left} left · ${threw.length} threw · ` +
        `${seconds.toFixed(1)}s · ${(BUYERS / seconds).toFixed(1)}/s\n`,
    );

    /*
     * Cleared before the assertions, not after.
     *
     * This run leaves a shop, a product and up to eighty orders behind, and
     * unlike the correctness suites it is measured — so its own leftovers are
     * an input to the next run. Enough of them change which plan Postgres
     * picks, and a throughput number that drifts because of junk rows from
     * previous runs is worse than no number, because it looks like a
     * regression in the code.
     *
     * Assertions throw, so anything after them only runs when the test passes,
     * which is exactly the case where cleanup matters least. Doing it here
     * means a failing run tidies up too.
     */
    await db.delete(orders).where(eq(orders.shopId, shop.id));
    await db.delete(products).where(eq(products.shopId, shop.id));
    await db.delete(paymentMethods).where(eq(paymentMethods.shopId, shop.id));
    await db.delete(shops).where(eq(shops.id, shop.id));
    await db.delete(user).where(eq(user.id, userId));

    // Nothing may throw: a checkout that errors is a buyer seeing a spinner
    // that never stops, which is how one order becomes three.
    expect(threw).toEqual([]);
    // The invariant. One oversell and this is wrong.
    expect(sold + left).toBe(STOCK);
    expect(left).toBeGreaterThanOrEqual(0);
    // Every success is a real row, and no failure left one behind.
    expect(orderRows).toBe(sold);
  }, 180_000);
});
