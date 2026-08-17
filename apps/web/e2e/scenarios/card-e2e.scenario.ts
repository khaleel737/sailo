import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDb } from "@sailo/db";
import { paymentMethods, products, shops, user } from "@sailo/db/schema";
import { createOrderIntent } from "@/lib/actions/orders";
import { assertLocalDatabase } from "./local-only";

/**
 * Places a real card order and prints the Stripe Checkout URL.
 *
 * Not an assertion suite — the driver for the one test nothing here could do
 * on its own: paying with a card. `e2e/scenarios/card-e2e.sh` runs this,
 * opens the URL it prints in a browser, pays with 4242…, and then checks that
 * the webhook settled the order. That whole loop is what proves Stripe still
 * produces the event shapes the handlers expect, which unit tests of the
 * handlers cannot.
 *
 * Needs `STRIPE_CONNECT_ACCOUNT` — a test connected account with
 * `charges_enabled`, because a direct charge has to land somewhere real.
 */
const ACCOUNT = process.env.STRIPE_CONNECT_ACCOUNT;

/*
 * Skipped unless a connected account is named, because this one reaches the
 * real Stripe API and needs somewhere for a direct charge to land. It is not
 * part of the default scenario run for that reason — see the header above.
 */
describe.skipIf(!ACCOUNT)("card checkout", () => {
  it("hands off to Stripe", async () => {
    assertLocalDatabase();
    const account = ACCOUNT as string;

    const db = getDb();
    const uid = () => crypto.randomUUID();
    const userId = uid();

    await db.insert(user).values({
      id: userId,
      name: "Card Seller",
      email: `card-${userId.slice(0, 8)}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [shop] = await db
      .insert(shops)
      .values({
        userId,
        handle: `card-${userId.slice(0, 8)}`,
        name: "Card Test Shop",
        currency: "USD",
        isPublished: true,
        plan: "business",
        /*
         * The subscription status too, not just the plan. `planFor` returns
         * `free` for a business plan with no entitled status — which is the
         * gate working, and is why this fixture failed the first time: the
         * card rail is refused for a shop that is not actually paying.
         */
        subscriptionStatus: "active",
        stripeAccountId: account,
        stripeChargesEnabled: true,
        stripeDetailsSubmitted: true,
      })
      .returning();
    if (!shop) throw new Error("fixture: no shop");

    await db.insert(paymentMethods).values({
      shopId: shop.id,
      type: "card",
      label: "Card",
      config: {} as never,
      isEnabled: true,
      position: 0,
    });
    const [product] = await db
      .insert(products)
      .values({
        shopId: shop.id,
        title: "Speckled Mug",
        slug: `mug-${userId.slice(0, 8)}`,
        kind: "physical",
        priceCents: 2400,
        isPublished: true,
        inStock: true,
        trackInventory: true,
        stockQuantity: 5,
      })
      .returning();
    if (!product) throw new Error("fixture: no product");

    const result = await createOrderIntent({
      shopId: shop.id,
      items: [{ productId: product.id, quantity: 2 }],
      paymentMethod: "card",
      customerName: "Jenny Rosen",
      customerEmail: "buyer-e2e@example.com",
      customerPhone: "+15555555555",
      addressLine1: "1 High Street",
      city: "Leeds",
      postalCode: "LS1 1AA",
      country: "UK",
    });

    expect(result.ok, result.ok ? "" : result.error).toBe(true);
    if (!result.ok) return;

    /*
     * Written to a file rather than logged: vitest intercepts stdout, so the
     * shell driver that has to open this URL in a browser would never see it.
     */
    /*
     * A card order's handoff is a redirect to Stripe. Narrowed rather than
     * asserted, because `Handoff` is a union — every other rail returns
     * `instructions` with no URL, and reading `.url` off the union would be
     * claiming something the type does not promise.
     */
    const handoff = result.handoff;
    const checkoutUrl =
      handoff && handoff.kind === "redirect" ? handoff.url : "";

    writeFileSync(
      process.env.CARD_E2E_OUT ?? "/tmp/card-e2e.env",
      [
        `ORDER_ID=${result.orderId}`,
        `PRODUCT_ID=${product.id}`,
        `SHOP_ID=${shop.id}`,
        `CHECKOUT_URL=${checkoutUrl}`,
      ].join("\n") + "\n",
    );
    expect(checkoutUrl, "Stripe must return a checkout URL").toContain("http");
  });
});
