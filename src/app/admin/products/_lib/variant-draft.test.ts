import { describe, expect, it } from "vitest";
import type { ProductVariant } from "@/db/schema";
import {
  BLANK,
  probablyMissingCommas,
  splitValues,
  toDrafts,
} from "./variant-draft";

/**
 * This logic converts stored money into what a seller sees in a form, and it
 * used to live inside a client component where nothing could reach it.
 *
 * The distinction that matters throughout: an empty field means "inherit from
 * the product", not "zero". A variant with no price of its own is priced by
 * its product; if empty ever became `0`, that variant would be free.
 */

function variant(over: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: "v1",
    productId: "p1",
    options: { Size: "M" },
    sku: null,
    priceCents: null,
    compareAtCents: null,
    stockQuantity: null,
    isAvailable: true,
    imageUrl: null,
    position: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as ProductVariant & typeof over;
}

describe("splitValues", () => {
  it("takes commas and newlines, because sellers paste both", () => {
    expect(splitValues("S, M, L")).toEqual(["S", "M", "L"]);
    expect(splitValues("S\nM\nL")).toEqual(["S", "M", "L"]);
    expect(splitValues("S,M\nL")).toEqual(["S", "M", "L"]);
  });

  it("drops blanks rather than making an empty option value", () => {
    expect(splitValues("S,,M,")).toEqual(["S", "M"]);
    expect(splitValues("  ")).toEqual([]);
    expect(splitValues("")).toEqual([]);
  });

  it("trims, so a pasted list doesn't create ' M' and 'M'", () => {
    expect(splitValues("  S ,  M  ")).toEqual(["S", "M"]);
  });

  it("takes the comma the seller's keyboard actually types", () => {
    // Arabic comma — an Arabic-locale admin never produces U+002C.
    expect(splitValues("نصف كيلو، كيلو، كيلوان")).toEqual([
      "نصف كيلو",
      "كيلو",
      "كيلوان",
    ]);
    // Full-width and ideographic commas from CJK input methods.
    expect(splitValues("小，中，大")).toEqual(["小", "中", "大"]);
    expect(splitValues("小、中、大")).toEqual(["小", "中", "大"]);
    // Semicolons, which spreadsheet exports use.
    expect(splitValues("S; M; L")).toEqual(["S", "M", "L"]);
  });

  it("never splits on spaces — a value can be 'Extra Large'", () => {
    expect(splitValues("Extra Large, Extra Small")).toEqual([
      "Extra Large",
      "Extra Small",
    ]);
  });
});

describe("probablyMissingCommas", () => {
  it("catches a space-separated list typed as one value", () => {
    expect(probablyMissingCommas("0.5kg 1kg 2kg")).toBe(true);
    expect(probablyMissingCommas("Small Medium Large")).toBe(true);
  });

  it("stays quiet once anything splits", () => {
    expect(probablyMissingCommas("0.5 kg, 1 kg")).toBe(false);
    expect(probablyMissingCommas("نصف كيلو، كيلو")).toBe(false);
  });

  it("stays quiet on one word, or nothing", () => {
    expect(probablyMissingCommas("Small")).toBe(false);
    expect(probablyMissingCommas("")).toBe(false);
    expect(probablyMissingCommas("   ")).toBe(false);
  });
});

describe("toDrafts", () => {
  it("keeps an unset price empty, never '0.00'", () => {
    const [draft] = Object.values(toDrafts([variant()]));
    expect(draft?.price).toBe("");
    expect(draft?.compareAt).toBe("");
    expect(draft?.stock).toBe("");
  });

  it("shows a real zero price as 0.00, which is not the same as unset", () => {
    const [draft] = Object.values(
      toDrafts([{ ...variant(), priceCents: 0 } as ProductVariant]),
    );
    expect(draft?.price).toBe("0.00");
  });

  it("converts minor units to two decimals", () => {
    const [draft] = Object.values(
      toDrafts([
        { ...variant(), priceCents: 1999, compareAtCents: 2999 } as ProductVariant,
      ]),
    );
    expect(draft?.price).toBe("19.99");
    expect(draft?.compareAt).toBe("29.99");
  });

  it("does not lose a cent on amounts that don't divide cleanly", () => {
    const [draft] = Object.values(
      toDrafts([{ ...variant(), priceCents: 1 } as ProductVariant]),
    );
    expect(draft?.price).toBe("0.01");
  });

  it("keeps zero stock distinct from untracked stock", () => {
    const tracked = Object.values(
      toDrafts([{ ...variant(), stockQuantity: 0 } as ProductVariant]),
    )[0];
    expect(tracked?.stock).toBe("0"); // sold out
    expect(Object.values(toDrafts([variant()]))[0]?.stock).toBe(""); // not counted
  });

  it("keys drafts by the option combination", () => {
    const drafts = toDrafts([
      { ...variant(), options: { Size: "S" } } as ProductVariant,
      { ...variant(), id: "v2", options: { Size: "M" } } as ProductVariant,
    ]);
    expect(Object.keys(drafts)).toHaveLength(2);
  });
});

describe("BLANK", () => {
  it("starts a new combination on sale", () => {
    // A seller who adds a size expects to be able to sell it.
    expect(BLANK.available).toBe(true);
  });

  it("starts every amount unset, so it inherits from the product", () => {
    expect(BLANK.price).toBe("");
    expect(BLANK.compareAt).toBe("");
    expect(BLANK.stock).toBe("");
  });
});
