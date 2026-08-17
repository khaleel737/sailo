import { describe, expect, it } from "vitest";
import type { Order, OrderItem } from "@sailo/db/schema";
import { decimalAmount, money, orderResource, sampleOrderResource } from "./resources";

/**
 * The one number in a payload that a consumer will get wrong.
 *
 * Every integration bug of the shape "the customer was told they paid 4999"
 * comes from a decimal that was assumed to be minor-units-over-a-hundred. This
 * is the function that makes the honest version available, and it has to be
 * right for the currencies where a hundred is not the divisor.
 */

describe("decimalAmount", () => {
  it("formats two-decimal currencies", () => {
    expect(decimalAmount(4999, "USD")).toBe("49.99");
    expect(decimalAmount(100, "GBP")).toBe("1.00");
    expect(decimalAmount(5, "EUR")).toBe("0.05");
    expect(decimalAmount(0, "USD")).toBe("0.00");
  });

  it("formats zero-decimal currencies without inventing a fraction", () => {
    // ¥4999 is four thousand nine hundred and ninety-nine yen, not ¥49.99.
    expect(decimalAmount(4999, "JPY")).toBe("4999");
    expect(decimalAmount(0, "JPY")).toBe("0");
    expect(decimalAmount(1, "KRW")).toBe("1");
  });

  it("formats three-decimal currencies", () => {
    // A fixed hundred here is wrong by a factor of ten.
    expect(decimalAmount(4999, "JOD")).toBe("4.999");
    expect(decimalAmount(1000, "KWD")).toBe("1.000");
    expect(decimalAmount(5, "BHD")).toBe("0.005");
  });

  it("keeps the sign on a negative, for a reversal", () => {
    expect(decimalAmount(-4999, "USD")).toBe("-49.99");
    expect(decimalAmount(-1, "JPY")).toBe("-1");
  });

  it("falls back to two decimals for a currency it does not know", () => {
    expect(decimalAmount(1234, "ZZZ")).toBe("12.34");
  });
});

describe("money", () => {
  it("always carries both forms and the currency", () => {
    expect(money(4999, "USD")).toEqual({
      cents: 4999,
      amount: "49.99",
      currency: "USD",
    });
  });

  it("treats a null amount as zero rather than dropping the field", () => {
    // A missing key is the shape a consumer's mapping breaks on; an explicit
    // zero is one it can render.
    expect(money(null, "GBP")).toEqual({ cents: 0, amount: "0.00", currency: "GBP" });
  });
});

describe("sampleOrderResource", () => {
  /**
   * A real order, every field populated, so the comparison below is about
   * *presence* rather than about which fields happened to be set.
   */
  const realOrder = {
    id: "b0a1c2d3-4e5f-6071-8293-a4b5c6d7e8f9",
    status: "shipped",
    paymentStatus: "paid",
    paymentMethod: "card",
    currency: "GBP",
    subtotalCents: 4000,
    discountCents: 500,
    deliveryFeeCents: 399,
    taxCents: 700,
    totalCents: 4599,
    refundedCents: 0,
    itemCount: 2,
    clientId: "c0a1c2d3-4e5f-6071-8293-a4b5c6d7e8f9",
    customerName: "Ada",
    customerEmail: "ada@example.com",
    customerPhone: "+15550100",
    addressLine1: "1 Test Street",
    addressLine2: "Flat 2",
    city: "Testville",
    region: "Testshire",
    postalCode: "TE1 1ST",
    country: "GB",
    deliveryMethod: "shipping",
    deliveryLabel: "Standard",
    pickupLocation: null,
    trackingCarrier: "Royal Mail",
    trackingNumber: "AB123",
    trackingUrl: "https://example.com/track",
    shippedAt: new Date("2026-08-11T10:00:00.000Z"),
    scheduledFor: null,
    serviceMode: null,
    serviceLocation: null,
    couponCode: "SPRING",
    affiliateCode: "ADA",
    note: "leave with neighbour",
    createdAt: new Date("2026-08-10T10:00:00.000Z"),
    updatedAt: new Date("2026-08-11T10:00:00.000Z"),
  } as unknown as Order;

  const realItem = {
    id: "d0a1c2d3-4e5f-6071-8293-a4b5c6d7e8f9",
    productId: "e0a1c2d3-4e5f-6071-8293-a4b5c6d7e8f9",
    variantId: null,
    title: "Speckled Mug",
    variantLabel: "Large",
    sku: "MUG-L",
    kind: "physical",
    quantity: 2,
    unitPriceCents: 2000,
    subtotalCents: 4000,
  } as unknown as OrderItem;

  /**
   * The property this exists for.
   *
   * Zapier builds its entire field map from the first payload it receives, so
   * a seller who presses "Send test" on a shop with no orders yet maps against
   * this object — and if it is missing keys a real order has, the Zap works
   * perfectly until their first real sale and then silently maps nulls. A
   * partial fixture cast to `Order` produces exactly that, because JSON drops
   * `undefined` rather than emitting null.
   */
  it("has exactly the keys a real order payload has", () => {
    const real = orderResource(realOrder, [realItem]);
    const sample = sampleOrderResource({ currency: "GBP" });

    expect(Object.keys(sample).slice().sort()).toEqual(Object.keys(real).slice().sort());

    for (const section of ["customer", "address", "delivery", "total"] as const) {
      expect(
        Object.keys(sample[section]).slice().sort(),
        `${section} drifted`,
      ).toEqual(Object.keys(real[section]).slice().sort());
    }

    const [sampleItem] = sample.items;
    const [realLine] = real.items;
    expect(sampleItem).toBeDefined();
    expect(Object.keys(sampleItem ?? {}).slice().sort()).toEqual(
      Object.keys(realLine ?? {}).slice().sort(),
    );
  });

  it("prices itself in the shop's currency", () => {
    expect(sampleOrderResource({ currency: "JPY" }).total).toEqual({
      cents: 2500,
      amount: "2500",
      currency: "JPY",
    });
  });
});
