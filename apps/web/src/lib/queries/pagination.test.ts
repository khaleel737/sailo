import { describe, expect, it } from "vitest";
import { nextOffsetFor, orderByIds } from "./pagination";
import { PRODUCT_PAGE_SIZE } from "./products";

/**
 * These cover the two ways a batched catalogue breaks without anyone noticing:
 * a shopper who scrolls and never reaches the end of the shop, and a batch
 * that arrives in a different order than the sort they picked.
 *
 * The SQL half — the `id` tiebreaker and the rating aggregate — can only be
 * proven against a real database; see `npm run check:load`.
 */

describe("nextOffsetFor", () => {
  it("asks for more while the catalogue has more", () => {
    expect(nextOffsetFor(0, 24, 100)).toBe(24);
    expect(nextOffsetFor(24, 24, 100)).toBe(48);
  });

  it("stops exactly when the last batch lands", () => {
    // 100 products, batches of 24: the fifth batch holds 4 and ends the scroll.
    expect(nextOffsetFor(96, 4, 100)).toBeNull();
  });

  it("stops when the batch divides the total evenly", () => {
    // The off-by-one that matters: 48 of 48 is the end, not an empty 49th.
    expect(nextOffsetFor(24, 24, 48)).toBeNull();
  });

  it("treats a short batch as the end", () => {
    // Fewer rows than asked for means there is nothing behind them.
    expect(nextOffsetFor(0, 10, 1000)).toBe(10);
    expect(nextOffsetFor(0, 0, 1000)).toBeNull();
  });

  it("ends rather than looping when the count is stale", () => {
    // The batch and the count are separate queries. If a product is
    // unpublished between them the batch comes back empty while the count
    // still promises more — and asking again would never terminate.
    expect(nextOffsetFor(48, 0, 100)).toBeNull();
  });

  it("handles a shop that fits in one batch", () => {
    expect(nextOffsetFor(0, 5, 5)).toBeNull();
    expect(nextOffsetFor(0, 0, 0)).toBeNull();
  });

  it("walks a whole catalogue exactly once", () => {
    // The property that matters: every product is visited, none twice.
    const total = 1000;
    const seen: number[] = [];
    let offset: number | null = 0;

    while (offset !== null) {
      const size = Math.min(PRODUCT_PAGE_SIZE, total - offset);
      for (let i = 0; i < size; i += 1) seen.push(offset + i);
      offset = nextOffsetFor(offset, size, total);
    }

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(total - 1);
  });
});

describe("orderByIds", () => {
  const rows = [
    { id: "c", title: "Mug" },
    { id: "a", title: "Poster" },
    { id: "b", title: "Sticker" },
  ];

  it("returns rows in the order SQL chose, not the order they arrived", () => {
    expect(orderByIds(["a", "b", "c"], rows).map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("preserves a sort the database picked", () => {
    expect(orderByIds(["b", "c", "a"], rows).map((r) => r.title)).toEqual([
      "Sticker",
      "Mug",
      "Poster",
    ]);
  });

  it("skips an id whose row vanished between the two queries", () => {
    expect(orderByIds(["a", "gone", "b"], rows).map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("never invents a row", () => {
    expect(orderByIds([], rows)).toEqual([]);
    expect(orderByIds(["a", "b"], [])).toEqual([]);
  });

  it("does not duplicate when an id repeats", () => {
    expect(orderByIds(["a", "a"], rows).map((r) => r.id)).toEqual(["a", "a"]);
  });
});
