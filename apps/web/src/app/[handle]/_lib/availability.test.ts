import { describe, expect, it } from "vitest";
import type { CheckoutVariant } from "@sailo/core/variants";
import { isSoldOut } from "./availability";

/**
 * Whether a buyer can order at all. Getting this wrong costs a sale in one
 * direction and oversells in the other, and it sat inside a client component
 * where nothing could reach it.
 *
 * Two stock models meet here, and the rule is which one wins.
 */

function v(over: Partial<CheckoutVariant> = {}): CheckoutVariant {
  return {
    id: "v",
    options: { Size: "M" },
    priceCents: null,
    compareAtCents: null,
    sku: null,
    stockQuantity: null,
    available: true,
    imageUrl: null,
    ...over,
  } as CheckoutVariant;
}

describe("isSoldOut", () => {
  it("respects the seller's switch above any count", () => {
    expect(isSoldOut({ inStock: false, unitsLeft: 99 })).toBe(true);
    expect(isSoldOut({ inStock: false, variants: [v()] })).toBe(true);
  });

  it("treats uncounted stock as buyable, not as none left", () => {
    // A seller who never turned on inventory tracking is always in stock.
    expect(isSoldOut({ inStock: true })).toBe(false);
    expect(isSoldOut({ inStock: true, unitsLeft: null })).toBe(false);
    expect(isSoldOut({ inStock: true, unitsLeft: undefined })).toBe(false);
  });

  it("is sold out at exactly zero units", () => {
    expect(isSoldOut({ inStock: true, unitsLeft: 0 })).toBe(true);
    expect(isSoldOut({ inStock: true, unitsLeft: 1 })).toBe(false);
  });

  it("stays open while any one variant can be bought", () => {
    expect(
      isSoldOut({
        inStock: true,
        variants: [v({ available: false }), v({ available: true })],
      }),
    ).toBe(false);
  });

  it("closes only when every variant is gone", () => {
    expect(
      isSoldOut({
        inStock: true,
        variants: [v({ available: false }), v({ available: false })],
      }),
    ).toBe(true);
  });

  it("ignores the product's own count once it has variants", () => {
    /*
     * This is the case that matters. A variant product keeps its stock on the
     * variants, and the product row's own count is left at zero. Reading it
     * would close a listing whose sizes are all in stock.
     */
    expect(
      isSoldOut({ inStock: true, unitsLeft: 0, variants: [v()] }),
    ).toBe(false);
  });

  it("falls back to the product's count when the variant list is empty", () => {
    expect(isSoldOut({ inStock: true, unitsLeft: 0, variants: [] })).toBe(true);
    expect(isSoldOut({ inStock: true, unitsLeft: 5, variants: [] })).toBe(false);
    expect(isSoldOut({ inStock: true, unitsLeft: 0, variants: null })).toBe(true);
  });
});
