import { describe, expect, it } from "vitest";
import { cartNeedsDelivery, cartSubtotal, lineSubtotal, summarise } from "@/lib/quote";
import { lineTitle, linesSubtotal, orderSummaryTitle } from "@/lib/order-lines";

const line = (over: Record<string, unknown> = {}) =>
  ({ unitPriceCents: 1_000, quantity: 1, kind: "physical", ...over }) as never;

describe("cart maths", () => {
  it("multiplies a line out", () => {
    expect(lineSubtotal({ unitPriceCents: 2_500, quantity: 3 })).toBe(7_500);
  });

  it("sums every line, not just the first", () => {
    expect(
      cartSubtotal([
        { unitPriceCents: 3_100, quantity: 1 },
        { unitPriceCents: 9_000, quantity: 1 },
      ]),
    ).toBe(12_100);
  });

  it("is zero for an empty cart", () => {
    expect(cartSubtotal([])).toBe(0);
  });
});

describe("cartNeedsDelivery", () => {
  it("is true when anything physical is in the basket", () => {
    expect(cartNeedsDelivery([line({ kind: "digital" }), line()])).toBe(true);
  });

  it("is false for downloads and services alone", () => {
    expect(
      cartNeedsDelivery([line({ kind: "digital" }), line({ kind: "service" })]),
    ).toBe(false);
  });

  it("is false for an empty basket", () => {
    expect(cartNeedsDelivery([])).toBe(false);
  });
});

describe("summarise", () => {
  it("names a single line", () => {
    expect(summarise([{ title: "Mug" }])).toBe("Mug");
  });

  it("includes the variant", () => {
    expect(summarise([{ title: "Mug", label: "Large" }])).toBe("Mug — Large");
  });

  it("says how many more there are", () => {
    expect(summarise([{ title: "Mug" }, { title: "Bowl" }, { title: "Plate" }])).toBe(
      "Mug and 2 more",
    );
  });

  it("is empty for nothing", () => {
    expect(summarise([])).toBe("");
  });
});

describe("order line helpers", () => {
  it("titles a line with its variant", () => {
    expect(lineTitle({ title: "Mug", variantLabel: "Large" })).toBe("Mug — Large");
    expect(lineTitle({ title: "Mug", variantLabel: null })).toBe("Mug");
  });

  it("sums line subtotals", () => {
    expect(linesSubtotal([{ subtotalCents: 3_100 }, { subtotalCents: 9_000 }])).toBe(
      12_100,
    );
  });

  it("names a whole order without hiding the rest of the basket", () => {
    // The header columns describe the first line only. Using them straight
    // called a four-item order "Mug" everywhere the seller reads it.
    expect(
      orderSummaryTitle({ productTitle: "Mug", variantLabel: "Large", itemCount: 4 }),
    ).toBe("Mug — Large + 3 more items");
  });

  it("says 'item' for exactly one more", () => {
    expect(
      orderSummaryTitle({ productTitle: "Mug", variantLabel: null, itemCount: 2 }),
    ).toBe("Mug + 1 more item");
  });

  it("adds nothing for a single-line order", () => {
    expect(
      orderSummaryTitle({ productTitle: "Mug", variantLabel: null, itemCount: 1 }),
    ).toBe("Mug");
  });
});
