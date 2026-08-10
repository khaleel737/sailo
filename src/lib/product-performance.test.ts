import { describe, expect, it } from "vitest";
import { conversionRate, mergePerformance } from "./product-performance";

describe("conversionRate", () => {
  it("is null with no views — a dash, never Infinity", () => {
    expect(conversionRate(0, 0)).toBeNull();
    expect(conversionRate(5, 0)).toBeNull();
  });

  it("is zero with views and no orders", () => {
    expect(conversionRate(0, 40)).toBe(0);
  });

  it("divides orders by views", () => {
    expect(conversionRate(3, 100)).toBe(0.03);
  });
});

describe("mergePerformance", () => {
  it("joins views and sales on the product id", () => {
    const rows = mergePerformance(
      [{ productId: "a", title: "Mug", views: 100 }],
      [
        {
          key: "a",
          productId: "a",
          title: "Mug",
          orders: 3,
          units: 4,
          revenueCents: 6000,
        },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ views: 100, orders: 3, conversion: 0.03 });
  });

  it("keeps a viewed-but-never-bought product on the page", () => {
    const rows = mergePerformance(
      [{ productId: "a", title: "Mug", views: 50 }],
      [],
    );
    expect(rows[0]).toMatchObject({ orders: 0, revenueCents: 0, conversion: 0 });
  });

  it("keeps a deleted product's sales, under its snapshotted title", () => {
    // Deletion nulls the product id on the order line; the revenue is real.
    const rows = mergePerformance(
      [],
      [
        {
          key: "gone:Old Mug",
          productId: null,
          title: "Old Mug",
          orders: 2,
          units: 2,
          revenueCents: 4000,
        },
      ],
    );
    expect(rows[0]).toMatchObject({
      productId: null,
      title: "Old Mug",
      views: 0,
      conversion: null,
    });
  });

  it("sorts by revenue, then views", () => {
    const rows = mergePerformance(
      [
        { productId: "viewed", title: "Viewed", views: 500 },
        { productId: "seller", title: "Seller", views: 10 },
      ],
      [
        {
          key: "seller",
          productId: "seller",
          title: "Seller",
          orders: 5,
          units: 5,
          revenueCents: 10_000,
        },
      ],
    );
    expect(rows.map((r) => r.key)).toEqual(["seller", "viewed"]);
  });
});
