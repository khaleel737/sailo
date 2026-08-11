import { describe, expect, it } from "vitest";
import {
  cartNeedsDelivery,
  cartSubtotal,
  lineSubtotal,
  quote,
  summarise,
  type QuoteLine,
} from "@/lib/quote";

/**
 * What a basket costs and what it needs from the buyer.
 *
 * This composes the pure pricing in `pricing.ts` with the facts about a cart
 * that only the cart knows: whether anything in it has to travel, whether an
 * address is therefore required, and how many units are involved. Every
 * checkout runs through it and none of it was tested.
 */

const line = (over: Partial<QuoteLine> = {}): QuoteLine =>
  ({
    productId: "p1",
    variantId: null,
    title: "Mug",
    sku: null,
    kind: "physical",
    imageUrl: null,
    unitPriceCents: 1_000,
    quantity: 1,
    scheduledFor: null,
    variantOptions: null,
    options: null,
    product: {},
    ...over,
  }) as unknown as QuoteLine;

const base = {
  coupon: null,
  deliveryMethod: null,
  commissionBp: null,
  tax: null,
  collectAddress: true,
  deliveryType: null,
  now: new Date("2026-08-06T00:00:00.000Z"),
};

describe("lineSubtotal", () => {
  it("multiplies price by quantity", () => {
    expect(lineSubtotal({ unitPriceCents: 1_250, quantity: 3 })).toBe(3_750);
  });

  it("is zero for a free line rather than negative or absent", () => {
    // A free product is a real product; 0 is a price, not a missing one.
    expect(lineSubtotal({ unitPriceCents: 0, quantity: 2 })).toBe(0);
  });

  it("refuses to produce a negative subtotal from bad input", () => {
    /*
     * Quantity and price both arrive from a client payload. A negative either
     * side would subtract from the order total — a discount the buyer wrote
     * themselves.
     */
    expect(lineSubtotal({ unitPriceCents: -500, quantity: 2 })).toBe(0);
    expect(lineSubtotal({ unitPriceCents: 500, quantity: -2 })).toBe(0);
    expect(lineSubtotal({ unitPriceCents: -500, quantity: -2 })).toBe(0);
  });
});

describe("cartSubtotal", () => {
  it("sums every line", () => {
    expect(
      cartSubtotal([
        { unitPriceCents: 1_000, quantity: 2 },
        { unitPriceCents: 250, quantity: 1 },
      ]),
    ).toBe(2_250);
  });

  it("is zero for an empty cart", () => {
    expect(cartSubtotal([])).toBe(0);
  });

  it("cannot be dragged down by one hostile line", () => {
    expect(
      cartSubtotal([
        { unitPriceCents: 1_000, quantity: 1 },
        { unitPriceCents: -10_000, quantity: 1 },
      ]),
    ).toBe(1_000);
  });
});

describe("cartNeedsDelivery", () => {
  it("is false for a basket that only contains downloads", () => {
    expect(cartNeedsDelivery([{ kind: "digital" }, { kind: "digital" }])).toBe(
      false,
    );
  });

  it("is false for a basket of appointments", () => {
    expect(cartNeedsDelivery([{ kind: "service" }])).toBe(false);
  });

  it("is true as soon as one thing has to travel", () => {
    // The fee is for the order, so a single mug among ten PDFs earns it.
    expect(
      cartNeedsDelivery([
        { kind: "digital" },
        { kind: "physical" },
        { kind: "service" },
      ]),
    ).toBe(true);
  });

  it("is false for an empty basket", () => {
    expect(cartNeedsDelivery([])).toBe(false);
  });
});

describe("quote", () => {
  it("counts units across lines, not lines", () => {
    // `unitCount` is what the order header stores as `quantity`, and reading
    // it as a line count has caused bugs before.
    const result = quote({
      ...base,
      lines: [line({ quantity: 2 }), line({ quantity: 3 })],
    });
    expect(result.unitCount).toBe(5);
    expect(result.lines).toHaveLength(2);
  });

  it("ignores a delivery method when there is nothing to deliver", () => {
    /*
     * A buyer whose basket is all downloads must not be charged shipping
     * because a rate was still selected in the UI.
     */
    const result = quote({
      ...base,
      lines: [line({ kind: "digital" })],
      deliveryMethod: { feeCents: 599, freeOverCents: null },
    });
    expect(result.needsDelivery).toBe(false);
    expect(result.totals.deliveryFeeCents).toBe(0);
  });

  it("charges the delivery fee once when something does travel", () => {
    const result = quote({
      ...base,
      lines: [line({ quantity: 3 }), line({ productId: "p2" })],
      deliveryMethod: { feeCents: 599, freeOverCents: null },
    });
    expect(result.needsDelivery).toBe(true);
    expect(result.totals.deliveryFeeCents).toBe(599);
  });

  it("asks for an address only when something is being shipped to one", () => {
    const shipped = quote({
      ...base,
      lines: [line()],
      deliveryMethod: { feeCents: 599, freeOverCents: null },
    });
    expect(shipped.needsAddress).toBe(true);

    const downloads = quote({ ...base, lines: [line({ kind: "digital" })] });
    expect(downloads.needsAddress).toBe(false);
  });

  it("does not ask for an address when the buyer is collecting", () => {
    // They are coming to the shop; a delivery address is a form field that
    // can only lose the sale.
    const result = quote({
      ...base,
      lines: [line()],
      deliveryType: "collection",
      deliveryMethod: { feeCents: 0, freeOverCents: null },
    });
    expect(result.needsDelivery).toBe(true);
    expect(result.needsAddress).toBe(false);
  });

  it("does not ask for an address when the shop does not collect one", () => {
    const result = quote({
      ...base,
      lines: [line()],
      collectAddress: false,
      deliveryMethod: { feeCents: 599, freeOverCents: null },
    });
    expect(result.needsAddress).toBe(false);
  });

  it("reports what kinds the basket holds", () => {
    const result = quote({
      ...base,
      lines: [line({ kind: "digital" }), line({ kind: "service" })],
    });
    expect(result.hasDigital).toBe(true);
    expect(result.hasService).toBe(true);
  });

  it("gives every line its own subtotal", () => {
    const result = quote({
      ...base,
      lines: [line({ quantity: 2, unitPriceCents: 1_500 })],
    });
    expect(result.lines[0]?.subtotalCents).toBe(3_000);
  });

  it("prices an empty basket at zero rather than throwing", () => {
    const result = quote({ ...base, lines: [] });
    expect(result.totals.totalCents).toBe(0);
    expect(result.unitCount).toBe(0);
    expect(result.needsAddress).toBe(false);
  });
});

describe("summarise", () => {
  it("names a single line", () => {
    expect(summarise([{ title: "Mug" }])).toBe("Mug");
  });

  it("includes the variant when there is one", () => {
    expect(summarise([{ title: "Mug", label: "Large" }])).toBe("Mug — Large");
  });

  it("counts the rest", () => {
    expect(
      summarise([{ title: "Mug" }, { title: "Shirt" }, { title: "Hat" }]),
    ).toBe("Mug and 2 more");
  });

  it("takes a translated tail, since this reaches the buyer", () => {
    expect(
      summarise([{ title: "Mug" }, { title: "Shirt" }], (n) => `und ${n} mehr`),
    ).toBe("Mug und 1 mehr");
  });

  it("is empty for no lines rather than dangling a connective", () => {
    expect(summarise([])).toBe("");
  });
});
