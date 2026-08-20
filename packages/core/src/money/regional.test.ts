import { describe, expect, it } from "vitest";
import {
  buildCurrencyPrices,
  couponAtCurrency,
  currencyForCountry,
  deliveryAtCurrency,
  hasPriceIn,
  normalizeOfferedCurrencies,
  priceIn,
  productAtCurrency,
  REGIONAL_CURRENCIES,
  resolveDisplayCurrency,
  variantAtCurrency,
} from "./regional";

/**
 * The rules that stop a euro sign appearing in front of a dollar integer.
 *
 * Every assertion here is about a refusal rather than a conversion, because
 * there is nothing to convert: the numbers were typed by a seller. What can go
 * wrong is that one is missing and something helpfully supplies another.
 */

const product = (prices: Record<string, unknown> = {}) => ({
  priceCents: 2900,
  compareAtCents: null as number | null,
  currencyPrices: prices as never,
});

describe("currencyForCountry", () => {
  it("quotes a euro-area buyer in euros", () => {
    expect(currencyForCountry("DE")).toBe("EUR");
    expect(currencyForCountry("ie")).toBe("EUR");
  });

  it("quotes the UK in pounds", () => {
    expect(currencyForCountry("GB")).toBe("GBP");
  });

  it("does not put a non-euro EU country in euros", () => {
    // The EU and the euro area are different sets, and quoting a Pole in euros
    // is the whole bug this map exists to avoid.
    expect(currencyForCountry("PL")).toBe("PLN");
    expect(currencyForCountry("SE")).toBe("SEK");
    expect(currencyForCountry("CZ")).toBe("CZK");
  });

  it("answers nothing for a country outside the market", () => {
    expect(currencyForCountry("BR")).toBeNull();
    expect(currencyForCountry("")).toBeNull();
    expect(currencyForCountry(undefined)).toBeNull();
  });

  it("only ever names a currency it is allowed to offer", () => {
    for (const code of [
      "DE", "GB", "US", "SE", "DK", "PL", "CZ", "HU", "RO",
      "CH", "LI", "NO", "CA", "AU", "JP", "AE",
    ]) {
      const found = currencyForCountry(code);
      expect(REGIONAL_CURRENCIES).toContain(found);
    }
  });
});

describe("resolveDisplayCurrency", () => {
  const shopCurrency = "USD";

  it("follows the geo header when the shop can quote it", () => {
    expect(
      resolveDisplayCurrency({ shopCurrency, live: ["EUR"], country: "DE" }),
    ).toBe("EUR");
  });

  it("falls back to the shop's own when the currency is not live", () => {
    // The shop enabled EUR and has not finished pricing it. The buyer is
    // quoted dollars and told nothing, which is what they get today.
    expect(
      resolveDisplayCurrency({ shopCurrency, live: [], country: "DE" }),
    ).toBe("USD");
  });

  it("honours the switcher over the header", () => {
    expect(
      resolveDisplayCurrency({
        shopCurrency,
        live: ["EUR", "GBP"],
        chosen: "GBP",
        country: "DE",
      }),
    ).toBe("GBP");
  });

  it("ignores a cookie naming a currency the shop no longer offers", () => {
    // A cookie outlives a seller switching a currency off. A stale one must not
    // resurrect a price list that is not live.
    expect(
      resolveDisplayCurrency({
        shopCurrency,
        live: ["EUR"],
        chosen: "GBP",
        country: "GB",
      }),
    ).toBe("USD");
  });

  it("always allows the shop's own currency to be chosen", () => {
    expect(
      resolveDisplayCurrency({
        shopCurrency,
        live: ["EUR"],
        chosen: "usd",
        country: "DE",
      }),
    ).toBe("USD");
  });
});

describe("priceIn", () => {
  it("reads a well-formed entry", () => {
    expect(priceIn(product({ EUR: { price: 2500, secondary: 3000 } }), "EUR")).toEqual({
      price: 2500,
      secondary: 3000,
    });
  });

  it("is case-insensitive on the code", () => {
    expect(hasPriceIn(product({ EUR: { price: 2500 } }), "eur")).toBe(true);
  });

  it("refuses an entry whose price is not a number", () => {
    // The column is jsonb written by a form. A string here would be
    // concatenated into a total rather than added to it.
    expect(priceIn(product({ EUR: { price: "2500" } }), "EUR")).toBeNull();
    expect(priceIn(product({ EUR: {} }), "EUR")).toBeNull();
    expect(priceIn(product({ EUR: null }), "EUR")).toBeNull();
    expect(priceIn(product({ EUR: { price: -1 } }), "EUR")).toBeNull();
  });

  it("treats a missing currency as missing, never as the row's own price", () => {
    expect(priceIn(product({ GBP: { price: 2200 } }), "EUR")).toBeNull();
  });

  it("keeps zero as a price and absent as absent", () => {
    // Blank ≠ zero: a free product in euros is priced, an unpriced one is not.
    expect(priceIn(product({ EUR: { price: 0 } }), "EUR")).toEqual({
      price: 0,
      secondary: null,
    });
    expect(priceIn(product({}), "EUR")).toBeNull();
  });
});

describe("productAtCurrency", () => {
  it("returns the row untouched for the shop's own currency", () => {
    const row = product({ EUR: { price: 2500 } });
    expect(productAtCurrency(row, "USD", "USD")).toBe(row);
  });

  it("swaps price and compare-at together", () => {
    const row = { ...product({ EUR: { price: 2500, secondary: 3000 } }), compareAtCents: 3900 };
    expect(productAtCurrency(row, "EUR", "USD")).toMatchObject({
      priceCents: 2500,
      compareAtCents: 3000,
    });
  });

  it("drops a compare-at that has no entry in the second currency", () => {
    // A €30 strike-through above a $25 price is the same lie in a smaller font.
    const row = { ...product({ EUR: { price: 2500 } }), compareAtCents: 3900 };
    expect(productAtCurrency(row, "EUR", "USD")?.compareAtCents).toBeNull();
  });

  it("refuses rather than falling back", () => {
    expect(productAtCurrency(product(), "EUR", "USD")).toBeNull();
  });
});

describe("variantAtCurrency", () => {
  const variant = (priceCents: number | null, prices: Record<string, unknown> = {}) => ({
    priceCents,
    compareAtCents: null as number | null,
    currencyPrices: prices as never,
  });

  it("lets an inheriting variant through with no entry of its own", () => {
    // A variant with no price inherits the product's, in every currency alike.
    // Demanding an entry here would take a whole catalogue out of euros for the
    // sake of rows that carry no price at all.
    const row = variant(null);
    expect(variantAtCurrency(row, "EUR", "USD")).toBe(row);
  });

  it("refuses a variant that overrides the price and has no entry", () => {
    expect(variantAtCurrency(variant(3500), "EUR", "USD")).toBeNull();
  });

  it("uses the variant's own entry when it has one", () => {
    expect(
      variantAtCurrency(variant(3500, { EUR: { price: 3000 } }), "EUR", "USD"),
    ).toMatchObject({ priceCents: 3000 });
  });
});

describe("deliveryAtCurrency", () => {
  const rate = (prices: Record<string, unknown> = {}) => ({
    feeCents: 500,
    freeOverCents: 5000 as number | null,
    currencyPrices: prices as never,
  });

  it("swaps the fee and the free-over threshold together", () => {
    expect(
      deliveryAtCurrency(rate({ EUR: { price: 450, secondary: 4500 } }), "EUR", "USD"),
    ).toMatchObject({ feeCents: 450, freeOverCents: 4500 });
  });

  it("refuses a rate with no entry", () => {
    expect(deliveryAtCurrency(rate(), "EUR", "USD")).toBeNull();
  });
});

describe("couponAtCurrency", () => {
  const percent = (prices: Record<string, unknown> = {}, min = 0) => ({
    discountType: "percent",
    discountValue: 1000,
    minSubtotalCents: min,
    currencyPrices: prices as never,
  });
  const fixed = (prices: Record<string, unknown> = {}) => ({
    discountType: "fixed",
    discountValue: 500,
    minSubtotalCents: 0,
    currencyPrices: prices as never,
  });

  it("lets a percentage coupon through untouched", () => {
    // 10% off is 10% off. A percentage is currency-free and needs no entry.
    const row = percent();
    expect(couponAtCurrency(row, "EUR", "USD")).toBe(row);
  });

  it("refuses a percentage coupon whose minimum subtotal has no entry", () => {
    // The minimum is money even when the discount is not.
    expect(couponAtCurrency(percent({}, 5000), "EUR", "USD")).toBeNull();
  });

  it("refuses a fixed coupon with no entry rather than converting it", () => {
    expect(couponAtCurrency(fixed(), "EUR", "USD")).toBeNull();
  });

  it("uses the fixed coupon's own amount", () => {
    expect(
      couponAtCurrency(fixed({ EUR: { price: 400, secondary: 2000 } }), "EUR", "USD"),
    ).toMatchObject({ discountValue: 400, minSubtotalCents: 2000 });
  });
});

describe("buildCurrencyPrices", () => {
  it("drops a blank price rather than storing a zero", () => {
    // Blank means "no price in this currency", which is what makes the currency
    // not live. Zero means free. Collapsing them sells a catalogue for nothing.
    expect(
      buildCurrencyPrices([{ currency: "EUR", priceCents: null }]),
    ).toEqual({});
    expect(
      buildCurrencyPrices([{ currency: "EUR", priceCents: 0 }]),
    ).toEqual({ EUR: { price: 0, secondary: null } });
  });

  it("refuses a currency outside the offered set", () => {
    expect(buildCurrencyPrices([{ currency: "BRL", priceCents: 1000 }])).toEqual({});
    expect(buildCurrencyPrices([{ currency: "ZZZ", priceCents: 1000 }])).toEqual({});
  });

  it("uppercases the code", () => {
    expect(buildCurrencyPrices([{ currency: "eur", priceCents: 100 }])).toEqual({
      EUR: { price: 100, secondary: null },
    });
  });
});

describe("normalizeOfferedCurrencies", () => {
  it("never includes the shop's own currency", () => {
    expect(normalizeOfferedCurrencies(["EUR", "USD"], "USD")).toEqual(["EUR"]);
  });

  it("stores a fixed order whatever order the form sent", () => {
    expect(normalizeOfferedCurrencies(["GBP", "EUR"], "USD")).toEqual(["EUR", "GBP"]);
    expect(normalizeOfferedCurrencies(["EUR", "GBP"], "USD")).toEqual(["EUR", "GBP"]);
  });

  it("drops anything that is not an offerable currency", () => {
    expect(normalizeOfferedCurrencies(["BRL", "nonsense", 7, null], "USD")).toEqual([]);
    expect(normalizeOfferedCurrencies("EUR", "USD")).toEqual([]);
  });
});
