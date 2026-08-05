import { beforeEach, describe, expect, it } from "vitest";
import {
  addLine,
  cachedTotal,
  cartCount,
  cartKey,
  lineKey,
  readCart,
  removeLine,
  setQuantity,
  toOrderItems,
  writeCart,
  type CartLine,
} from "@/lib/cart";

/** A minimal localStorage, so the browser-side cart can be tested in node. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

const SHOP = "shop-1";
const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  variantId: null,
  quantity: 1,
  title: "Mug",
  label: "",
  kind: "physical",
  unitPriceCents: 2_400,
  imageUrl: null,
  ...over,
});

beforeEach(() => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage, dispatchEvent: () => true },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
});

describe("keys", () => {
  it("namespaces a cart per shop", () => {
    expect(cartKey(SHOP)).toContain(SHOP);
    expect(cartKey("other")).not.toBe(cartKey(SHOP));
  });

  it("treats two variants of one product as different lines", () => {
    expect(lineKey({ productId: "p1", variantId: "v1" })).not.toBe(
      lineKey({ productId: "p1", variantId: "v2" }),
    );
  });

  it("treats a variantless product consistently", () => {
    expect(lineKey({ productId: "p1", variantId: null })).toBe(
      lineKey({ productId: "p1", variantId: null }),
    );
  });
});

describe("addLine", () => {
  it("adds a new line", () => {
    expect(addLine([], line())).toHaveLength(1);
  });

  it("merges quantities for the same variant rather than duplicating", () => {
    const lines = addLine([line({ quantity: 1 })], line({ quantity: 2 }));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(3);
  });

  it("keeps different variants apart", () => {
    const lines = addLine([line({ variantId: "v1" })], line({ variantId: "v2" }));
    expect(lines).toHaveLength(2);
  });

  it("caps a merged quantity", () => {
    const lines = addLine([line({ quantity: 900 })], line({ quantity: 900 }));
    expect(lines[0]?.quantity).toBeLessThanOrEqual(999);
  });

  it("refuses to grow past a sane basket size", () => {
    let lines: CartLine[] = [];
    for (let i = 0; i < 80; i++) lines = addLine(lines, line({ productId: `p${i}` }));
    expect(lines.length).toBeLessThanOrEqual(50);
  });
});

describe("setQuantity and removeLine", () => {
  it("changes a quantity", () => {
    const lines = setQuantity([line()], lineKey(line()), 4);
    expect(lines[0]?.quantity).toBe(4);
  });

  it("removes the line when the quantity reaches zero", () => {
    // A shopper stepping down to zero means "take it out", not "keep a zero".
    expect(setQuantity([line()], lineKey(line()), 0)).toHaveLength(0);
  });

  it("clamps a quantity above the maximum", () => {
    expect(setQuantity([line()], lineKey(line()), 100_000)[0]?.quantity).toBe(999);
  });

  it("removes a line by key", () => {
    expect(removeLine([line()], lineKey(line()))).toHaveLength(0);
  });

  it("ignores a key that isn't there", () => {
    expect(removeLine([line()], "nope")).toHaveLength(1);
  });
});

describe("totals", () => {
  it("counts units, not lines", () => {
    expect(cartCount([line({ quantity: 2 }), line({ productId: "p2", quantity: 3 })])).toBe(5);
  });

  it("sums the cached prices for first paint", () => {
    expect(
      cachedTotal([
        line({ unitPriceCents: 2_400, quantity: 2 }),
        line({ productId: "p2", unitPriceCents: 1_000, quantity: 1 }),
      ]),
    ).toBe(5_800);
  });

  it("hands the server only what it needs to re-price", () => {
    // The cached title and price are never trusted; the order is built from
    // ids and quantities and priced again from the database.
    const items = toOrderItems([line({ variantId: "v1", quantity: 2 })]);
    expect(items[0]).toMatchObject({ productId: "p1", variantId: "v1", quantity: 2 });
    expect(items[0]).not.toHaveProperty("unitPriceCents");
    expect(items[0]).not.toHaveProperty("title");
  });
});

describe("storage", () => {
  it("round-trips a cart", () => {
    writeCart(SHOP, [line({ quantity: 2 })]);
    expect(readCart(SHOP)[0]?.quantity).toBe(2);
  });

  it("keeps two shops' carts apart", () => {
    writeCart(SHOP, [line()]);
    expect(readCart("other-shop")).toHaveLength(0);
  });

  it("returns an empty cart rather than throwing on corrupt storage", () => {
    localStorage.setItem(cartKey(SHOP), "{not json");
    expect(readCart(SHOP)).toEqual([]);
  });

  it("ignores stored data of the wrong shape", () => {
    localStorage.setItem(cartKey(SHOP), JSON.stringify({ nope: true }));
    expect(readCart(SHOP)).toEqual([]);
  });
});
