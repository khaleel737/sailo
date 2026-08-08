import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { products, shops, user } from "@/db/schema";
import { getPublicProducts, productSearchExpr } from "@/lib/queries/products";
import { eq, sql } from "drizzle-orm";
import { assertLocalDatabase } from "./local-only";

/**
 * The storefront search has to keep using its trigram index.
 *
 * `products_search_trgm_idx` indexes an expression, and Postgres only uses an
 * expression index when the query's expression parses to the same tree. So the
 * SQL in `readPublicProducts` and the SQL in drizzle/0005_product_search.sql are
 * coupled by nothing but a comment asking the next person to keep them equal.
 *
 * Break that coupling and nothing fails: the query still returns exactly the
 * right rows, just by reading the shop's whole catalogue. It stays invisible
 * until a shop is big enough for it to hurt, and by then it's a production
 * problem rather than a test failure. So the assertion here is on the *plan*,
 * not the results — the one thing a correctness test cannot see.
 */
describe("storefront search", () => {
  it("uses the trigram index rather than scanning the catalogue", async () => {
    assertLocalDatabase();
    const db = getDb();
    const userId = crypto.randomUUID();

    await db.insert(user).values({
      id: userId,
      name: "Search Seller",
      email: `search-${userId}@example.com`,
      emailVerified: true,
    });
    const [shop] = await db
      .insert(shops)
      .values({
        userId,
        handle: `search-${userId.slice(0, 8)}`,
        name: "Search Shop",
        currency: "USD",
        plan: "business",
        subscriptionStatus: "active",
        isPublished: true,
      })
      .returning();
    if (!shop) throw new Error("fixture: shop was not inserted");

    // Enough rows that a sequential scan is the expensive option. Below a few
    // thousand the planner is right to ignore the index and this proves
    // nothing, so the row count is part of the test, not a detail.
    const ROWS = 12_000;
    await db.execute(sql`
      INSERT INTO products (shop_id, title, slug, kind, price_cents, is_published, in_stock, description)
      SELECT ${shop.id}, 'Product ' || g, 'search-' || g, 'physical', 1000, true, true,
             'assorted goods number ' || g
      FROM generate_series(1, ${ROWS}) g
    `);
    // The needles. A search only benefits from an index when it is selective;
    // a term matching most of the catalogue is really a browse, and there the
    // planner is right to scan. So the term searched below has to be rare, the
    // way a shopper looking for one thing in a large catalogue is.
    const MATCHES = 5;
    await db.execute(sql`
      INSERT INTO products (shop_id, title, slug, kind, price_cents, is_published, in_stock, description)
      SELECT ${shop.id}, 'Kaleidoscope ' || g, 'needle-' || g, 'physical', 1000, true, true, 'rare'
      FROM generate_series(1, ${MATCHES}) g
    `);
    await db.execute(sql`ANALYZE products`);

    // The query under test, run for real first — the plan is only meaningful
    // if this is the SQL the storefront actually issues.
    const page = await getPublicProducts(shop.id, "USD", { q: "kaleidoscope" }, 0, 24);
    expect(page.total).toBe(MATCHES);
    expect(page.items).toHaveLength(MATCHES);

    // Planned through the exported expression rather than a copy of it. A copy
    // would keep passing after someone edited the real one, which is exactly
    // the drift this test exists to catch.
    const term = "%kaleidoscope%";
    const plan = await db.execute(sql`
      EXPLAIN SELECT id FROM products
      WHERE shop_id = ${shop.id}
        AND is_published = true
        AND ${productSearchExpr} ILIKE ${term}
    `);
    const text = plan.rows.map((r) => Object.values(r)[0]).join("\n");

    expect(text).toContain("products_search_trgm_idx");
    expect(text).not.toContain("Seq Scan on products");

    await db.delete(products).where(eq(products.shopId, shop.id));
    await db.delete(shops).where(eq(shops.id, shop.id));
    await db.delete(user).where(eq(user.id, userId));
  }, 120_000);

  it("matches across the title and description boundary", async () => {
    assertLocalDatabase();
    const db = getDb();
    const userId = crypto.randomUUID();

    await db.insert(user).values({
      id: userId,
      name: "Boundary Seller",
      email: `boundary-${userId}@example.com`,
      emailVerified: true,
    });
    const [shop] = await db
      .insert(shops)
      .values({
        userId,
        handle: `bound-${userId.slice(0, 8)}`,
        name: "Boundary Shop",
        currency: "USD",
        plan: "business",
        subscriptionStatus: "active",
        isPublished: true,
      })
      .returning();
    if (!shop) throw new Error("fixture: shop was not inserted");

    await db.insert(products).values([
      {
        shopId: shop.id,
        title: "Blue",
        slug: "blue",
        kind: "physical",
        priceCents: 1000,
        isPublished: true,
        inStock: true,
        description: "mug for tea",
      },
      {
        shopId: shop.id,
        title: "Red Kettle",
        slug: "red-kettle",
        kind: "physical",
        priceCents: 2000,
        isPublished: true,
        inStock: true,
        description: null,
      },
    ]);

    // Searching the two columns separately could never match this: "blue mug"
    // exists only across the join. Concatenating is what makes it findable,
    // and that is an improvement worth pinning rather than an accident.
    const spanning = await getPublicProducts(shop.id, "USD", { q: "Blue mug" }, 0, 24);
    expect(spanning.items.map((p) => p.title)).toEqual(["Blue"]);

    // A null description must not swallow the row — coalesce carries its
    // weight here, and dropping it would make this product unsearchable.
    const nullDesc = await getPublicProducts(shop.id, "USD", { q: "kettle" }, 0, 24);
    expect(nullDesc.items.map((p) => p.title)).toEqual(["Red Kettle"]);

    await db.delete(products).where(eq(products.shopId, shop.id));
    await db.delete(shops).where(eq(shops.id, shop.id));
    await db.delete(user).where(eq(user.id, userId));
  });
});
