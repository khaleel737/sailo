import { describe, expect, it } from "vitest";
import type { Shop } from "@sailo/db/schema";
import { hasInvoiceIdentity, invoiceIdentity } from "./invoice-identity";

/**
 * Who the invoice says the seller is.
 *
 * The property this file exists to hold is the *fallback*: every column behind
 * the structured block is nullable, most shops will never fill one in, and an
 * invoice issued before they existed has to reprint today byte-identical. A
 * regression here is not a crash — it is a header that quietly stops naming the
 * business, on a document somebody has already filed.
 */

const shop = (over: Partial<Shop> = {}) =>
  ({
    name: "Ada's Ceramics",
    location: "Lisbon, Portugal",
    contactEmail: "hello@adas.example",
    taxId: "PT123456789",
    invoiceLegalName: null,
    invoiceAddressLine1: null,
    invoiceAddressLine2: null,
    invoiceCity: null,
    invoiceRegion: null,
    invoicePostalCode: null,
    invoiceCountry: null,
    invoiceRegistrationNumber: null,
    ...over,
  }) as Shop;

describe("hasInvoiceIdentity", () => {
  it("is false for a shop that has filled nothing in", () => {
    expect(hasInvoiceIdentity(shop())).toBe(false);
  });

  it("is decided by the legal name alone", () => {
    /*
     * A seller who typed a postcode and wandered off has not given us an
     * invoice header. Treating "any field set" as identity would drop the
     * `location` line that was carrying the address and produce an invoice
     * saying *less* than before they touched the form.
     */
    expect(hasInvoiceIdentity(shop({ invoicePostalCode: "1000-001" }))).toBe(false);
    expect(hasInvoiceIdentity(shop({ invoiceLegalName: "Ada Lda" }))).toBe(true);
  });

  it("ignores whitespace typed into the legal name", () => {
    expect(hasInvoiceIdentity(shop({ invoiceLegalName: "   " }))).toBe(false);
  });
});

describe("invoiceIdentity", () => {
  describe("with nothing filled in", () => {
    it("prints exactly what the invoice printed before these columns existed", () => {
      expect(invoiceIdentity(shop())).toEqual({
        name: "Ada's Ceramics",
        tradingAs: null,
        addressLines: ["Lisbon, Portugal"],
        email: "hello@adas.example",
        taxId: "PT123456789",
        registrationNumber: null,
      });
    });

    it("leaves free-text location unparsed", () => {
      /*
       * It is a storefront caption a seller wrote for a different purpose, so
       * there is no shape to rely on — guessing which comma separates a city
       * from a country is how a Portuguese address becomes a Brazilian one.
       */
      expect(invoiceIdentity(shop({ location: "3rd floor, Rua Augusta 100" }))
        .addressLines).toEqual(["3rd floor, Rua Augusta 100"]);
    });

    it("has no address lines at all when there is no location", () => {
      expect(invoiceIdentity(shop({ location: null })).addressLines).toEqual([]);
    });
  });

  describe("with a registered entity", () => {
    const registered = shop({
      invoiceLegalName: "Ada Lovelace Unipessoal Lda",
      invoiceAddressLine1: "Rua Augusta 100",
      invoiceAddressLine2: "3rd floor",
      invoiceCity: "Lisboa",
      invoicePostalCode: "1100-053",
      invoiceCountry: "PT",
      invoiceRegistrationNumber: "PT514789123",
    });

    it("leads with the registered name", () => {
      expect(invoiceIdentity(registered).name).toBe("Ada Lovelace Unipessoal Lda");
    });

    it("names the trading name the buyer actually bought from", () => {
      /*
       * Without it the invoice reads as though it came from a company the
       * buyer has never dealt with — which is a chargeback waiting to be filed.
       */
      expect(invoiceIdentity(registered).tradingAs).toBe("Ada's Ceramics");
    });

    it("does not say a name trades as itself", () => {
      const same = shop({ invoiceLegalName: "ada's ceramics" });
      expect(invoiceIdentity(same).tradingAs).toBeNull();
    });

    it("stacks the address the way a postal format prints it", () => {
      expect(invoiceIdentity(registered).addressLines).toEqual([
        "Rua Augusta 100",
        "3rd floor",
        "Lisboa 1100-053",
        "Portugal",
      ]);
    });

    it("drops the lines the seller left empty", () => {
      const sparse = shop({
        invoiceLegalName: "Ada Lda",
        invoiceAddressLine1: "Rua Augusta 100",
        invoiceCountry: "PT",
      });
      expect(invoiceIdentity(sparse).addressLines).toEqual([
        "Rua Augusta 100",
        "Portugal",
      ]);
    });

    it("localises the country name", () => {
      expect(invoiceIdentity(registered, "pt").addressLines.at(-1)).toBe("Portugal");
      expect(invoiceIdentity(registered, "de").addressLines.at(-1)).toBe("Portugal");
      expect(invoiceIdentity(shop({
        invoiceLegalName: "Ada GmbH",
        invoiceCountry: "DE",
      }), "de").addressLines).toEqual(["Deutschland"]);
    });

    it("keeps the company number distinct from the VAT number", () => {
      const identity = invoiceIdentity(registered);
      expect(identity.taxId).toBe("PT123456789");
      expect(identity.registrationNumber).toBe("PT514789123");
    });

    it("stops using the storefront location once an address is given", () => {
      // The two would otherwise both print, and the invoice would state the
      // seller's address twice in two different formats.
      expect(invoiceIdentity(registered).addressLines).not.toContain(
        "Lisbon, Portugal",
      );
    });
  });
});
