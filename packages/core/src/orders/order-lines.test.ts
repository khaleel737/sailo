import { describe, expect, it } from "vitest";
import { lineTitle, linesSubtotal, orderSummaryTitle, shipsAsParcel } from "./order-lines";

/**
 * This module exists because an order had two representations — header
 * columns describing its first line, and item rows describing all of them —
 * and five separate money bugs came from reading the wrong one.
 *
 * It had no test of its own, which is the gap most worth closing: the whole
 * point of the module is to be the single answer to "what is in this order?"
 */

describe("orderSummaryTitle", () => {
  it("names a single-item order by its product", () => {
    expect(
      orderSummaryTitle({ productTitle: "Speckled mug", variantLabel: null, itemCount: 1 }),
    ).toBe("Speckled mug");
  });

  it("says how much else is in a basket", () => {
    /*
     * The bug this was written for. The header describes line one, so using it
     * straight calls a four-item basket "Speckled mug" — in the seller's order
     * list, the notification, the shipping email and the WhatsApp handoff.
     * That is the difference between packing one thing and packing four.
     */
    expect(
      orderSummaryTitle({ productTitle: "Speckled mug", variantLabel: null, itemCount: 4 }),
    ).toBe("Speckled mug + 3 more items");
  });

  it("says 'item' for exactly one more", () => {
    expect(
      orderSummaryTitle({ productTitle: "Speckled mug", variantLabel: null, itemCount: 2 }),
    ).toBe("Speckled mug + 1 more item");
  });

  it("keeps the variant on the named line", () => {
    // A seller packing needs the size, not just the product.
    expect(
      orderSummaryTitle({ productTitle: "Tee", variantLabel: "Large", itemCount: 1 }),
    ).toBe("Tee — Large");
    expect(
      orderSummaryTitle({ productTitle: "Tee", variantLabel: "Large", itemCount: 3 }),
    ).toBe("Tee — Large + 2 more items");
  });

  it("never says '+ 0 more' or a negative count", () => {
    // itemCount arrives from a stored column and older rows may carry 0.
    expect(
      orderSummaryTitle({ productTitle: "Mug", variantLabel: null, itemCount: 0 }),
    ).toBe("Mug");
  });
});

describe("lineTitle", () => {
  it("joins a product to its variant the way a receipt reads", () => {
    expect(lineTitle({ title: "Speckled mug", variantLabel: "Large" })).toBe(
      "Speckled mug — Large",
    );
  });

  it("leaves a product without variants alone", () => {
    // No trailing dash on something that has no variant.
    expect(lineTitle({ title: "Speckled mug", variantLabel: null })).toBe("Speckled mug");
  });
});

describe("linesSubtotal", () => {
  it("adds every line, not just the first", () => {
    // Reading the header alone is what charged a cart for one item.
    expect(
      linesSubtotal([{ subtotalCents: 1200 }, { subtotalCents: 4500 }, { subtotalCents: 999 }]),
    ).toBe(6699);
  });

  it("is zero for an empty order rather than NaN", () => {
    expect(linesSubtotal([])).toBe(0);
  });

  it("stays in whole cents", () => {
    expect(Number.isInteger(linesSubtotal([{ subtotalCents: 1 }, { subtotalCents: 2 }]))).toBe(
      true,
    );
  });
});

describe("shipsAsParcel", () => {
  const line = (kind: string) => ({ kind });

  it("ships when the method says shipping, whatever the lines hold", () => {
    expect(shipsAsParcel({ deliveryMethod: "shipping" }, [line("digital")])).toBe(true);
  });

  it("never ships explicit collection, even for physical goods", () => {
    expect(shipsAsParcel({ deliveryMethod: "collection" }, [line("physical")])).toBe(false);
  });

  it("asks the lines when no method was ever configured", () => {
    /*
     * The bug this was written for. The gate read `order.productKind`, which
     * is the header's first line — so a basket whose first line was a
     * download and whose second was a mug could never be marked shipped: the
     * ship panel never promoted and bulk "Mark as shipped" silently skipped
     * it. Any physical line makes a parcel.
     */
    expect(
      shipsAsParcel({ deliveryMethod: null }, [line("digital"), line("physical")]),
    ).toBe(true);
    expect(shipsAsParcel({ deliveryMethod: null }, [line("digital")])).toBe(false);
    expect(shipsAsParcel({ deliveryMethod: null }, [])).toBe(false);
  });
});
