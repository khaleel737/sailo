import { describe, expect, it } from "vitest";
import { formatAddress } from "./address";

/**
 * An address, on one line.
 *
 * Split out of `money/currency-parsing.test.ts` — see the note in
 * `../identity/slug.test.ts`.
 */

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

/**
 * Money as a human typed it.
 *
 * Sailo ships in 22 languages and both separator conventions are in daily use.
 * This used to strip everything but digits and a dot, so "12,5" — an ordinary
 * way to write €12.50 — became €125. A seller pricing in euros, lira, reais or
 * rupiah overcharged by a factor of ten with no validation message, while the
 * tax-rate field beside it already read the same string as 12.5.
 */
