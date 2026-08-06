import { describe, expect, it } from "vitest";
import type { ProductOption } from "@/db/schema";
import {
  combinations,
  MAX_VARIANTS,
  normalizeOptions,
  optionKey,
  sameOptions,
  variantPrice,
} from "./variants";

/**
 * How a product's options become the things a buyer can actually pick.
 *
 * A combination that doesn't round-trip is a variant nobody can select: the
 * picker offers it, the lookup misses, and the buyer is told the thing they
 * are looking at is unavailable.
 */

const opt = (name: string, values: string[]): ProductOption => ({ name, values });

describe("optionKey", () => {
  it("is the same key however the object was built", () => {
    // The picker builds it in the option's order; the database returns JSON in
    // whatever order it stored. Both have to find the same variant.
    expect(optionKey({ Size: "L", Colour: "Red" })).toBe(
      optionKey({ Colour: "Red", Size: "L" }),
    );
  });

  it("ignores the casing a seller happened to type", () => {
    expect(optionKey({ Size: "Large" })).toBe(optionKey({ size: "large" }));
  });

  it("keeps different combinations apart", () => {
    expect(optionKey({ Size: "L" })).not.toBe(optionKey({ Size: "M" }));
    expect(optionKey({ Size: "L" })).not.toBe(optionKey({ Colour: "L" }));
  });

  it("does not collide across a value that contains the separator", () => {
    // "Red|Blue" as one value must not read as two options.
    expect(optionKey({ Colour: "Red|Blue" })).not.toBe(
      optionKey({ Colour: "Red", Blue: "" }),
    );
  });
});

describe("sameOptions", () => {
  it("matches regardless of key order", () => {
    expect(sameOptions({ Size: "L", Colour: "Red" }, { Colour: "Red", Size: "L" })).toBe(
      true,
    );
  });

  it("does not match a partial combination", () => {
    // Half an answer is not the variant.
    expect(sameOptions({ Size: "L", Colour: "Red" }, { Size: "L" })).toBe(false);
  });
});

describe("combinations", () => {
  it("is empty when the product has no options", () => {
    expect(combinations([])).toEqual([]);
  });

  it("produces every pairing across two axes", () => {
    const all = combinations([opt("Size", ["S", "M"]), opt("Colour", ["Red", "Blue"])]);
    expect(all).toHaveLength(4);
    expect(all.map(optionKey).toSorted()).toEqual(
      [
        { Size: "S", Colour: "Red" },
        { Size: "S", Colour: "Blue" },
        { Size: "M", Colour: "Red" },
        { Size: "M", Colour: "Blue" },
      ]
        .map(optionKey)
        .toSorted(),
    );
  });

  it("gives every combination a complete answer on every axis", () => {
    // A combination missing an axis is one the picker can never satisfy.
    for (const combo of combinations([opt("Size", ["S", "M"]), opt("Colour", ["Red"])])) {
      expect(Object.keys(combo).toSorted()).toEqual(["Colour", "Size"]);
    }
  });

  it("stops at the variant ceiling rather than generating thousands", () => {
    const many = combinations([
      opt("A", ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]),
      opt("B", ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]),
      opt("C", ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]),
    ]);
    expect(many.length).toBeLessThanOrEqual(MAX_VARIANTS);
  });
});

describe("normalizeOptions", () => {
  it("drops an option with no name", () => {
    expect(normalizeOptions([opt("  ", ["S"])])).toEqual([]);
  });

  it("keeps the first of two options named the same", () => {
    // Two "Size" axes would give every combination two answers for one thing.
    const clean = normalizeOptions([opt("Size", ["S"]), opt("size", ["L"])]);
    expect(clean).toHaveLength(1);
  });

  it("removes a repeated value within one option", () => {
    const [first] = normalizeOptions([opt("Size", ["S", "S", "M"])]);
    expect(first?.values).toEqual(["S", "M"]);
  });

  it("drops an option left with no values", () => {
    expect(normalizeOptions([opt("Size", ["  ", ""])])).toEqual([]);
  });
});

describe("variantPrice", () => {
  it("uses the product's price when the variant sets none", () => {
    // Empty means inherit, which is why the column is nullable.
    expect(variantPrice({ priceCents: 1999, compareAtCents: null }, { priceCents: null })).toBe(1999);
    expect(variantPrice({ priceCents: 1999, compareAtCents: null }, null)).toBe(1999);
  });

  it("uses the variant's own price when it has one", () => {
    expect(variantPrice({ priceCents: 1999, compareAtCents: null }, { priceCents: 2499 })).toBe(2499);
  });

  it("honours a variant priced at zero rather than inheriting", () => {
    // A deliberately free variant must not silently cost the product's price.
    expect(variantPrice({ priceCents: 1999, compareAtCents: null }, { priceCents: 0 })).toBe(0);
  });
});
