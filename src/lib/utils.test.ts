import { describe, expect, it } from "vitest";
import { formatAddress, formatMoney, normalizePhone, slugify } from "./utils";

/**
 * The helpers that turn stored values into what a buyer reads.
 *
 * All four appear on receipts, so a wrong result here is not a broken page —
 * it is a wrong number on a document someone keeps.
 */

describe("formatMoney", () => {
  it("renders minor units as an amount", () => {
    expect(formatMoney(1999, "USD")).toContain("19.99");
  });

  it("drops the cents on a whole amount, and keeps them otherwise", () => {
    // Deliberate: a £20 product reads as "$20", not "$20.00", while anything
    // with cents shows both digits so a price never appears truncated.
    expect(formatMoney(2000, "USD")).toBe("$20");
    expect(formatMoney(1999, "USD")).toBe("$19.99");
    expect(formatMoney(0, "USD")).toBe("$0");
  });

  it("never shows a single trailing digit", () => {
    // "$19.9" would read as a different price from "$19.90".
    expect(formatMoney(1990, "USD")).toBe("$19.90");
  });

  it("marks the currency, so two shops' totals cannot be confused", () => {
    expect(formatMoney(1000, "USD")).not.toBe(formatMoney(1000, "EUR"));
  });

  it("does not round a cent away", () => {
    expect(formatMoney(1, "USD")).toContain("0.01");
    expect(formatMoney(99, "USD")).toContain("0.99");
  });

  it("survives a currency the runtime does not know", () => {
    // The code comes from a shop's settings and reaches this on every page.
    expect(() => formatMoney(1000, "XYZ")).not.toThrow();
    expect(formatMoney(1000, "XYZ")).toBeTruthy();
  });

  it("marks a negative, which a refund line carries", () => {
    expect(formatMoney(-500, "USD")).toBe("-$5");
    expect(formatMoney(-599, "USD")).toBe("-$5.99");
  });
});

describe("slugify", () => {
  it("makes a URL-safe handle out of a title", () => {
    expect(slugify("Speckled Mug")).toBe("speckled-mug");
  });

  it("collapses punctuation and spacing rather than leaving it in a path", () => {
    expect(slugify("  Tea & Coffee!!  ")).toBe("tea-coffee");
  });

  it("never produces a leading or trailing dash", () => {
    // "/shop/-mug-" is a different URL from "/shop/mug".
    expect(slugify("!Mug!")).toBe("mug");
    expect(slugify("--mug--")).toBe("mug");
  });

  it("returns something for a title with nothing safe in it", () => {
    // An empty slug would make a product unreachable at any URL.
    expect(slugify("!!!")).toBeTruthy();
  });
});

describe("normalizePhone", () => {
  it("keeps only the digits, so one number has one form", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizePhone("+1-555-123-4567")).toBe("15551234567");
  });

  it("returns empty for something with no digits at all", () => {
    // Empty is what lets a caller treat it as absent rather than as a number.
    expect(normalizePhone("not a phone")).toBe("");
  });
});

describe("formatAddress", () => {
  it("joins the parts a courier needs", () => {
    const address = formatAddress({
      addressLine1: "1 High Street",
      city: "Leeds",
      postalCode: "LS1 1AA",
      country: "UK",
    });
    expect(address).toContain("1 High Street");
    expect(address).toContain("Leeds");
    expect(address).toContain("LS1 1AA");
  });

  it("leaves no gap where a missing part was", () => {
    // "1 High Street, , Leeds" reads as a fault on a shipping label.
    const address = formatAddress({
      addressLine1: "1 High Street",
      addressLine2: null,
      city: "Leeds",
    });
    expect(address).not.toMatch(/,\s*,/);
    expect(address.trim()).not.toMatch(/,$/);
  });

  it("is empty when there is no address, rather than punctuation", () => {
    // A collection order has none, and a lone comma looks like data loss.
    expect(formatAddress({}).trim()).toBe("");
  });
});
