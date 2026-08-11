import { describe, expect, it } from "vitest";
import { hasActiveFilters } from "./get-shop-page-data";
import type { ShopFilters } from "@/lib/queries";

describe("hasActiveFilters", () => {
  it("is false for an untouched page", () => {
    expect(hasActiveFilters({} as ShopFilters)).toBe(false);
  });

  it.each([
    ["q", { q: "mug" }],
    ["category", { category: "mugs" }],
    ["kind", { kind: "digital" }],
    ["min", { min: "10" }],
    ["max", { max: "50" }],
    ["inStock", { inStock: "1" }],
  ])("is true when %s narrows the list", (_name, filters) => {
    expect(hasActiveFilters(filters as ShopFilters)).toBe(true);
  });

  it("ignores sorting", () => {
    // Sorting never removes anything, so an empty page after sorting means the
    // shop is empty — not that a filter was too tight. Saying "try clearing a
    // filter" there sends the shopper looking for something that isn't set.
    expect(hasActiveFilters({ sort: "price_asc" } as ShopFilters)).toBe(false);
  });

  it("treats an empty string as not set", () => {
    // Next gives `?q=` as "", which is a cleared box, not a search.
    expect(hasActiveFilters({ q: "", category: "" } as ShopFilters)).toBe(false);
  });
});
