import { describe, expect, it } from "vitest";
import { taxLabel, taxName } from "./tax-label";

/**
 * The word beside the tax line, written out in five places before this — three
 * of them hardcoding English while the invoice page used the translated one.
 * A German shop's invoice page said "MwSt." and its PDF said "Tax" for the
 * same order.
 */

const order = (over: Partial<{ taxName: string | null; taxRateBp: number }> = {}) => ({
  taxName: null,
  taxRateBp: 0,
  ...over,
});

describe("taxName", () => {
  it("uses the seller's own word for it", () => {
    // "VAT", "GST", "IVA" — the shop's word beats any default.
    expect(taxName(order({ taxName: "VAT" }))).toBe("VAT");
  });

  it("falls back when the seller never named it", () => {
    expect(taxName(order())).toBe("Tax");
  });

  it("takes a caller's translation for the fallback", () => {
    // The PDF has no dictionary; the invoice page does. Both call this.
    expect(taxName(order(), "MwSt.")).toBe("MwSt.");
    expect(taxName(order({ taxName: "VAT" }), "MwSt.")).toBe("VAT");
  });

  it("treats an empty or blank name as unnamed", () => {
    // "" would otherwise render a tax line with no label at all.
    expect(taxName(order({ taxName: "" }))).toBe("Tax");
    expect(taxName(order({ taxName: "   " }))).toBe("Tax");
  });
});

describe("taxLabel", () => {
  it("shows the rate beside the name", () => {
    expect(taxLabel(order({ taxName: "VAT", taxRateBp: 2000 }))).toBe("VAT (20%)");
  });

  it("omits the rate when there isn't one", () => {
    // "(0%)" beside a tax line reads as a mistake.
    expect(taxLabel(order({ taxName: "VAT", taxRateBp: 0 }))).toBe("VAT");
  });

  it("carries a fractional rate rather than rounding it away", () => {
    expect(taxLabel(order({ taxName: "GST", taxRateBp: 750 }))).toBe("GST (7.5%)");
  });

  it("uses the caller's fallback word with the rate", () => {
    expect(taxLabel(order({ taxRateBp: 1900 }), "MwSt.")).toBe("MwSt. (19%)");
  });
});
