import { describe, expect, it } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { getDb } from "@/db";
import { paymentMethods, products, shops, user } from "@/db/schema";

/**
 * A shop that sells one thing and takes orders over WhatsApp.
 *
 * Seeded for the iPhone repro in `e2e/whatsapp-handoff.spec.ts` — the checkout
 * has to exist in a database a browser can reach, and the scenario harness is
 * the only thing in the repo that guarantees it is the local one.
 *
 * Two phone numbers, because the bug being chased is about what
 * `https://wa.me/<number>` does with each: one in full international form and
 * one as a seller in the UAE would actually type it.
 */
describe("seed a WhatsApp shop", () => {
  it("writes a shop, a rail and a product", async () => {
    assertLocalDatabase();
    const db = getDb();
    const userId = crypto.randomUUID();

    await db.insert(user).values({
      id: userId,
      name: "Seller",
      email: `wa-${userId.slice(0, 8)}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const [shop] = await db
      .insert(shops)
      .values({
        userId,
        handle: "wa-repro",
        name: "WhatsApp Shop",
        currency: "USD",
        isPublished: true,
        plan: "free",
        collectAddress: false,
      })
      .returning();
    if (!shop) throw new Error("shop");

    await db.insert(paymentMethods).values({
      shopId: shop.id,
      type: "whatsapp",
      label: "WhatsApp",
      // Full international form, digits only — what `normalizePhone` produces
      // from a correctly entered number.
      config: { phone: "+971501234567" } as never,
      isEnabled: true,
      position: 0,
    });

    await db.insert(products).values({
      shopId: shop.id,
      title: "Blue Hoodie",
      slug: "blue-hoodie",
      kind: "physical",
      priceCents: 4_500,
      isPublished: true,
      inStock: true,
    });

    expect(shop.handle).toBe("wa-repro");
    console.log(`\nseeded /${shop.handle} — shop ${shop.id}\n`);
  });
});
