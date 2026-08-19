import { describe, expect, it } from "vitest";
import type { ProductOption } from "@sailo/db/schema";
import {
  cartCanPayInPerson,
  combinations,
  deliveryOf,
  isDigitalDelivery,
  retargetSelection,
  MAX_QUANTITY,
  MAX_VARIANTS,
  maxOrderable,
  quantityCeiling,
  normalizeOptions,
  optionKey,
  perOrderCap,
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
    expect(all.map(optionKey).sort()).toEqual(
      [
        { Size: "S", Colour: "Red" },
        { Size: "S", Colour: "Blue" },
        { Size: "M", Colour: "Red" },
        { Size: "M", Colour: "Blue" },
      ]
        .map(optionKey)
        .sort(),
    );
  });

  it("gives every combination a complete answer on every axis", () => {
    // A combination missing an axis is one the picker can never satisfy.
    for (const combo of combinations([opt("Size", ["S", "M"]), opt("Colour", ["Red"])])) {
      expect(Object.keys(combo).sort()).toEqual(["Colour", "Size"]);
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

describe("retargetSelection", () => {
  const v = (
    id: string,
    options: Record<string, string>,
    available = true,
    unitsLeft: number | null = null,
  ) => ({
    id,
    options,
    priceCents: 1000,
    compareAtCents: null,
    available,
    unitsLeft,
    imageUrl: null,
  });

  const variants = [
    v("s-red", { Size: "S", Colour: "Red" }),
    v("s-blue", { Size: "S", Colour: "Blue" }),
    v("l-red", { Size: "L", Colour: "Red" }),
    v("l-blue", { Size: "L", Colour: "Blue" }, false),
  ];

  it("keeps the rest of the selection when the combination is for sale", () => {
    const target = retargetSelection(
      variants,
      { Size: "S", Colour: "Red" },
      "Colour",
      "Blue",
    );
    expect(target?.id).toBe("s-blue");
  });

  it("jumps to the nearest sellable combination carrying the value", () => {
    // L/Blue is sold out, so picking Blue from L lands on the Blue that exists.
    const target = retargetSelection(
      variants,
      { Size: "L", Colour: "Red" },
      "Colour",
      "Blue",
    );
    expect(target?.id).toBe("s-blue");
  });

  it("returns the sold-out exact match when nothing sellable carries the value", () => {
    // The caller shows it as unavailable rather than pretending it's gone.
    const only = [v("l-blue", { Size: "L", Colour: "Blue" }, false)];
    const target = retargetSelection(
      only,
      { Size: "L", Colour: "Blue" },
      "Colour",
      "Blue",
    );
    expect(target?.id).toBe("l-blue");
    expect(target?.available).toBe(false);
  });

  it("returns null for a value no combination carries", () => {
    expect(
      retargetSelection(variants, { Size: "S", Colour: "Red" }, "Colour", "Green"),
    ).toBeNull();
  });
});

/**
 * Whether "pay when we meet" is an offer this order can keep.
 *
 * Two ways to get it wrong, and each was live at some point. Offering the rail
 * on an online video call promised a doorstep the order does not have —
 * nothing reaches anyone on a call. Withdrawing it from anything non-physical
 * took it off an in-person workshop, which is exactly the kind of shop that
 * needs it most.
 */
const item = (
  kind: string,
  over: { serviceMode?: string; releaseOnPayment?: boolean } = {},
) => ({
  kind,
  serviceMode: over.serviceMode ?? "in_person",
  releaseOnPayment: over.releaseOnPayment ?? true,
});

describe("cartCanPayInPerson", () => {
  it("keeps the rail for a physical good", () => {
    expect(cartCanPayInPerson([item("physical")])).toBe(true);
  });

  it("keeps it for the workshop the buyer turns up to", () => {
    expect(cartCanPayInPerson([item("service")])).toBe(true);
    expect(cartCanPayInPerson([item("event")])).toBe(true);
  });

  it("withdraws it from a video call, which nothing reaches", () => {
    expect(cartCanPayInPerson([item("service", { serviceMode: "online" })])).toBe(false);
    expect(cartCanPayInPerson([item("event", { serviceMode: "online" })])).toBe(false);
  });

  it("withdraws it from a download, held or not", () => {
    // A held file is safe from being taken and never paid for, but there is
    // still no moment anywhere in the order at which cash could change hands.
    expect(cartCanPayInPerson([item("digital", { releaseOnPayment: true })])).toBe(false);
    expect(cartCanPayInPerson([item("digital", { releaseOnPayment: false })])).toBe(false);
  });

  it("keeps it for a mug bought alongside a held file", () => {
    // The door is where both arrive, so the order has its moment.
    expect(
      cartCanPayInPerson([item("physical"), item("digital", { releaseOnPayment: true })]),
    ).toBe(true);
  });

  it("withdraws it when anything in the basket unlocks first", () => {
    // The instant download is gone before the doorstep, so "pay later" could
    // become "pay never" for something already handed over.
    expect(
      cartCanPayInPerson([item("physical"), item("digital", { releaseOnPayment: false })]),
    ).toBe(false);
  });

  it("withdraws it from an empty order rather than assuming one", () => {
    expect(cartCanPayInPerson([])).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*  How many one order may take                                                */
/* -------------------------------------------------------------------------- */

/**
 * Stock and the seller's per-order cap are different refusals, and a ticketed
 * event means both at once: a room of 200 that will not sell anybody a fifth
 * seat. The picker, the basket and the checkout all clamp through this one
 * function, so a quantity a buyer can reach is a quantity the order honours.
 */
const stocked = (over: Partial<Parameters<typeof maxOrderable>[0]> = {}) => ({
  inStock: true,
  trackInventory: false,
  stockQuantity: null,
  ...over,
});

describe("maxOrderable", () => {
  it("offers the hard cap when nothing else limits it", () => {
    expect(maxOrderable(stocked())).toBe(MAX_QUANTITY);
  });

  it("stops at what is left when the seller counts stock", () => {
    expect(
      maxOrderable(stocked({ trackInventory: true, stockQuantity: 3 })),
    ).toBe(3);
  });

  it("stops at the seller's cap even with plenty on the shelf", () => {
    expect(maxOrderable(stocked({ maxPerOrder: 4 }))).toBe(4);
  });

  it("takes whichever of stock and cap bites first, in both directions", () => {
    // Two seats left on a four-a-head event: two.
    expect(
      maxOrderable(
        stocked({ trackInventory: true, stockQuantity: 2, maxPerOrder: 4 }),
      ),
    ).toBe(2);
    // Two hundred seats on a four-a-head event: four.
    expect(
      maxOrderable(
        stocked({ trackInventory: true, stockQuantity: 200, maxPerOrder: 4 }),
      ),
    ).toBe(4);
  });

  it("never offers more than the hard cap, whatever the seller typed", () => {
    expect(maxOrderable(stocked({ maxPerOrder: 10_000 }))).toBe(MAX_QUANTITY);
  });
});

describe("quantityCeiling", () => {
  /*
   * The same rule from the two numbers a client already holds. The buy box and
   * the basket are handed `unitsLeft` and the cap resolved, with no product row
   * to pass `maxOrderable` — so they call this, and `maxOrderable` is built
   * from it. One implementation, four callers.
   */
  it("is the hard cap when neither stock nor the seller limits it", () => {
    expect(quantityCeiling(null, null)).toBe(MAX_QUANTITY);
    expect(quantityCeiling(null, undefined)).toBe(MAX_QUANTITY);
  });

  it("takes whichever of stock and cap bites first", () => {
    expect(quantityCeiling(2, 4)).toBe(2);
    expect(quantityCeiling(200, 4)).toBe(4);
    expect(quantityCeiling(3, null)).toBe(3);
  });

  it("reads a zero or negative cap as no cap", () => {
    expect(quantityCeiling(null, 0)).toBe(MAX_QUANTITY);
    expect(quantityCeiling(null, -2)).toBe(MAX_QUANTITY);
  });

  it("agrees with `maxOrderable`, which is built from it", () => {
    const product = stocked({
      trackInventory: true,
      stockQuantity: 6,
      maxPerOrder: 4,
    });
    expect(maxOrderable(product)).toBe(quantityCeiling(6, 4));
  });
});

describe("perOrderCap", () => {
  it("reads a blank cap as no cap", () => {
    expect(perOrderCap(stocked())).toBeNull();
    expect(perOrderCap(stocked({ maxPerOrder: null }))).toBeNull();
  });

  it("reads zero as no cap rather than as an embargo", () => {
    /*
     * A seller who wants to stop selling has `inStock`. A zero here is far
     * more likely a cleared field, and honouring it would render a quantity
     * picker whose only legal value is none.
     */
    expect(perOrderCap(stocked({ maxPerOrder: 0 }))).toBeNull();
    expect(perOrderCap(stocked({ maxPerOrder: -3 }))).toBeNull();
  });

  it("discards a cap that is not a number", () => {
    expect(perOrderCap(stocked({ maxPerOrder: Number.NaN }))).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  What a digital product hands over                                          */
/* -------------------------------------------------------------------------- */

describe("deliveryOf", () => {
  it("knows the three shapes a digital good comes in", () => {
    expect(isDigitalDelivery("file")).toBe(true);
    expect(isDigitalDelivery("link")).toBe(true);
    expect(isDigitalDelivery("code")).toBe(true);
    expect(isDigitalDelivery("email")).toBe(false);
    expect(isDigitalDelivery(null)).toBe(false);
  });

  it("reads the seller's choice on a digital product", () => {
    expect(deliveryOf({ kind: "digital", digitalDelivery: "link" })).toBe("link");
    expect(deliveryOf({ kind: "digital", digitalDelivery: "code" })).toBe("code");
  });

  it("falls back to files rather than guessing", () => {
    expect(deliveryOf({ kind: "digital", digitalDelivery: "nonsense" })).toBe("file");
    expect(deliveryOf({ kind: "digital", digitalDelivery: null })).toBe("file");
  });

  it("answers files for everything that is not digital", () => {
    /*
     * Not a null answer, deliberately: a mug delivers no link and no code, and
     * a caller asking "should I render the access details" wants "no" rather
     * than a special case of its own. A stale value left on a product switched
     * away from digital must not resurrect either.
     */
    expect(deliveryOf({ kind: "physical", digitalDelivery: "link" })).toBe("file");
    expect(deliveryOf({ kind: "event", digitalDelivery: "code" })).toBe("file");
  });
});
