import { describe, expect, it } from "vitest";
import {
  anySellable,
  combinations,
  findVariant,
  isLowStock,
  isSellable,
  LOW_STOCK_THRESHOLD,
  MAX_OPTIONS,
  MAX_VALUES_PER_OPTION,
  maxOrderable,
  normalizeOptions,
  optionKey,
  priceRange,
  sameOptions,
  unitsLeft,
  variantCompareAt,
  variantLabel,
  variantPrice,
} from "@/lib/variants";

const SIZE = { name: "Size", values: ["Small", "Large"] };
const COLOUR = { name: "Colour", values: ["Blue", "White"] };

describe("normalizeOptions", () => {
  it("keeps a clean definition", () => {
    expect(normalizeOptions([SIZE])).toEqual([SIZE]);
  });

  it("drops an option with no values", () => {
    expect(normalizeOptions([{ name: "Size", values: [] }])).toEqual([]);
  });

  it("drops an unnamed option", () => {
    expect(normalizeOptions([{ name: "  ", values: ["x"] }])).toEqual([]);
  });

  it("removes duplicate values", () => {
    const [first] = normalizeOptions([{ name: "Size", values: ["S", "S", "M"] }]);
    expect(first?.values).toEqual(["S", "M"]);
  });

  it("caps how many axes a product can have", () => {
    const many = Array.from({ length: MAX_OPTIONS + 3 }, (_, i) => ({
      name: `Opt${i}`,
      values: ["a"],
    }));
    expect(normalizeOptions(many).length).toBeLessThanOrEqual(MAX_OPTIONS);
  });

  it("caps how many values one axis can have", () => {
    const wide = [{ name: "Size", values: Array.from({ length: 40 }, (_, i) => `v${i}`) }];
    expect(normalizeOptions(wide)[0]?.values.length).toBeLessThanOrEqual(
      MAX_VALUES_PER_OPTION,
    );
  });
});

describe("combinations", () => {
  it("produces the cartesian product", () => {
    const combos = combinations([SIZE, COLOUR]);
    expect(combos).toHaveLength(4);
    expect(combos).toContainEqual({ Size: "Small", Colour: "Blue" });
    expect(combos).toContainEqual({ Size: "Large", Colour: "White" });
  });

  it("returns nothing for a product with no options", () => {
    // No axes means no variants — not one nameless variant.
    expect(combinations([])).toEqual([]);
  });
});

describe("option identity", () => {
  it("keys a combination stably regardless of insertion order", () => {
    expect(optionKey({ Size: "S", Colour: "B" })).toBe(
      optionKey({ Colour: "B", Size: "S" }),
    );
  });

  it("compares two combinations", () => {
    expect(sameOptions({ Size: "S" }, { Size: "S" })).toBe(true);
    expect(sameOptions({ Size: "S" }, { Size: "L" })).toBe(false);
  });

  it("labels a combination in the order the seller defined", () => {
    expect(variantLabel({ Colour: "Blue", Size: "Large" }, [SIZE, COLOUR])).toBe(
      "Large / Blue",
    );
  });

  it("finds a variant by its combination", () => {
    const variants = [{ options: { Size: "Small" } }, { options: { Size: "Large" } }];
    expect(findVariant(variants, { Size: "Large" })).toBe(variants[1]);
    expect(findVariant(variants, { Size: "Medium" })).toBeUndefined();
  });
});

describe("pricing a variant", () => {
  const product = { priceCents: 2_400, compareAtCents: 3_000 };

  it("uses the variant price when it has one", () => {
    expect(variantPrice(product, { priceCents: 3_100 })).toBe(3_100);
  });

  it("falls back to the product's base price", () => {
    expect(variantPrice(product, { priceCents: null })).toBe(2_400);
    expect(variantPrice(product, null)).toBe(2_400);
  });

  it("does the same for the compare-at price", () => {
    expect(variantCompareAt(product, { compareAtCents: 3_500 })).toBe(3_500);
    expect(variantCompareAt(product, null)).toBe(3_000);
  });

  it("reports a range across variants", () => {
    const range = priceRange(product, [
      { priceCents: 2_400, isAvailable: true },
      { priceCents: 3_100, isAvailable: true },
    ] as never);
    expect(range).toMatchObject({ min: 2_400, max: 3_100, varies: true });
  });

  it("says the price doesn't vary when every variant agrees", () => {
    const range = priceRange(product, [
      { priceCents: 2_400, isAvailable: true },
    ] as never);
    expect(range.varies).toBe(false);
  });

  it("prices from what's buyable, ignoring sold-out variants", () => {
    // A sold-out cheap variant shouldn't advertise a "from" price nobody can
    // actually pay.
    const range = priceRange(product, [
      { priceCents: 1_000, isAvailable: false },
      { priceCents: 3_100, isAvailable: true },
    ] as never);
    expect(range.min).toBe(3_100);
  });

  it("falls back to every variant when none is available", () => {
    const range = priceRange(product, [
      { priceCents: 1_000, isAvailable: false },
    ] as never);
    expect(range.min).toBe(1_000);
  });
});

describe("stock", () => {
  const tracked = { trackInventory: true, stockQuantity: 3, inStock: true };
  const untracked = { trackInventory: false, stockQuantity: null, inStock: true };

  it("counts units on a tracked product", () => {
    expect(unitsLeft(tracked, null)).toBe(3);
  });

  it("counts nothing on an untracked one", () => {
    // Null means nobody is counting, which is different from zero.
    expect(unitsLeft(untracked, null)).toBeNull();
  });

  it("prefers the variant's own count", () => {
    expect(unitsLeft(tracked, { stockQuantity: 1 } as never)).toBe(1);
  });

  it("is sellable while units remain", () => {
    expect(isSellable(tracked, null)).toBe(true);
    expect(isSellable({ ...tracked, stockQuantity: 0 }, null)).toBe(false);
  });

  it("is unsellable when the seller switched it off, however much stock", () => {
    expect(isSellable({ ...tracked, inStock: false }, null)).toBe(false);
  });

  it("caps an order at what is left", () => {
    expect(maxOrderable(tracked, null)).toBe(3);
  });

  it("caps an untracked order at the hard maximum, not at infinity", () => {
    expect(maxOrderable(untracked, null)).toBeGreaterThan(0);
    expect(Number.isFinite(maxOrderable(untracked, null))).toBe(true);
  });

  it("knows whether anything at all can be bought", () => {
    const sold = { stockQuantity: 0, isAvailable: true };
    const left = { stockQuantity: 2, isAvailable: true };
    expect(anySellable(tracked, [sold, left] as never)).toBe(true);
    expect(anySellable(tracked, [sold] as never)).toBe(false);
  });

  it("respects a variant the seller switched off", () => {
    expect(
      anySellable(tracked, [{ stockQuantity: 9, isAvailable: false }] as never),
    ).toBe(false);
  });

  it("warns on low stock but not on untracked", () => {
    expect(isLowStock(LOW_STOCK_THRESHOLD)).toBe(true);
    expect(isLowStock(LOW_STOCK_THRESHOLD + 1)).toBe(false);
    expect(isLowStock(null)).toBe(false);
  });
});
