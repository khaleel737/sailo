import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  CURRENCY_CODES,
  currencyDecimals,
  currencyLabel,
  isCurrencyCode,
  minorPerMajor,
  toCurrencyCode,
  toStripeAmount,
} from "@sailo/core/currency";
import { formatMoney, moneyToCents, parseMoneyToCents } from "@sailo/core/currency";

/*
 * The whole table exists for one number, so most of these test that number
 * rather than the list around it. A currency added with the wrong `decimals`
 * does not fail anywhere visible: the seller types a price, sees it echoed
 * back correctly, and a buyer is charged a hundred times more or less.
 */

describe("the currency table", () => {
  it("has no duplicates", () => {
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
  });

  it("uses well-formed ISO codes", () => {
    for (const code of CURRENCY_CODES) expect(code).toMatch(/^[A-Z]{3}$/);
  });

  it("is a list Intl can actually format", () => {
    // A code Intl rejects throws inside `formatMoney` and falls back to a bare
    // number, which is how a storefront ends up showing "30.00 XYZ".
    for (const code of CURRENCY_CODES) {
      const format = () =>
        new Intl.NumberFormat("en", { style: "currency", currency: code }).format(1);
      expect(format, code).not.toThrow();
    }
  });

  it("declares only the three decimal counts that exist", () => {
    for (const { code, decimals } of CURRENCIES) {
      expect([0, 2, 3], code).toContain(decimals);
    }
  });

  it("keeps the currencies that were already on offer", () => {
    // Existing shops are priced in these. Dropping one would leave rows
    // pointing at a code the picker no longer offers.
    for (const code of ["USD", "EUR", "GBP", "AED", "SAR", "EGP", "TRY", "INR",
                        "NGN", "KES", "ZAR", "BRL", "MXN", "PKR", "IDR", "PHP",
                        "CAD", "AUD"]) {
      expect(CURRENCY_CODES, code).toContain(code);
    }
  });

  it("carries the ones a seller in each of these markets needs", () => {
    for (const code of ["ILS", "UAH", "JOD", "AED", "SEK", "NOK", "DKK", "ISK",
                        "JPY", "CNY", "HKD", "SGD", "MYR", "THB", "KRW", "TWD",
                        "VND", "CHF", "PLN", "NZD", "KZT", "AZN", "AMD",
                        "BOB", "PYG"]) {
      expect(CURRENCY_CODES, code).toContain(code);
    }
  });

  it("covers every EU currency, euro or not", () => {
    // The seven national currencies still in use across the EU. Croatia
    // adopted the euro in 2023, so kuna is deliberately absent.
    for (const code of ["EUR", "BGN", "CZK", "DKK", "HUF", "PLN", "RON", "SEK"]) {
      expect(CURRENCY_CODES, code).toContain(code);
    }
  });

  it("can price a shop in every language it can be read in", () => {
    /*
     * This is the check that found four gaps. Sailo ships a translated
     * dashboard in Macedonian, Albanian and Bosnian, and a seller reading one
     * could not price in their own money — the sort of hole that is invisible
     * from the currency list and obvious from the locale list.
     */
    const homeCurrency: Record<string, string> = {
      mk: "MKD", sq: "ALL", bs: "BAM", sr: "RSD", uk: "UAH", bg: "BGN",
      ro: "RON", cs: "CZK", pl: "PLN", hu: "HUF", da: "DKK", sv: "SEK",
      no: "NOK", tr: "TRY", th: "THB", vi: "VND", ja: "JPY", ko: "KRW",
      zh: "CNY", id: "IDR", ms: "MYR", fil: "PHP", ar: "AED", he: "ILS",
    };
    for (const [locale, code] of Object.entries(homeCurrency)) {
      expect(CURRENCY_CODES, `${locale} sellers need ${code}`).toContain(code);
    }
  });
});

describe("minor units", () => {
  it("knows the yen has none", () => {
    expect(currencyDecimals("JPY")).toBe(0);
    expect(minorPerMajor("JPY")).toBe(1);
  });

  it("knows the Gulf dinars have three", () => {
    for (const code of ["JOD", "KWD", "BHD", "OMR", "TND"]) {
      expect(currencyDecimals(code), code).toBe(3);
      expect(minorPerMajor(code), code).toBe(1000);
    }
  });

  it("assumes two for anything it does not know", () => {
    /*
     * The safe direction. Treating an unknown zero-decimal currency as
     * two-decimal shows a price a hundred times too small — visible, and
     * nobody is overcharged. The reverse would charge a hundred times too
     * much before anyone noticed.
     */
    expect(currencyDecimals("ZZZ")).toBe(2);
  });

  it("is case-insensitive, because Stripe returns codes in lower case", () => {
    expect(currencyDecimals("jpy")).toBe(0);
  });
});

describe("a price survives the round trip", () => {
  it("stores what a seller typed, in every decimal shape", () => {
    // ¥1,000 is a thousand minor units. Multiplying by 100 stored ¥100,000
    // and Stripe charged it.
    expect(moneyToCents("1000", "JPY")).toBe(1000);
    expect(moneyToCents("19.99", "USD")).toBe(1999);
    expect(moneyToCents("9.999", "JOD")).toBe(9999);
  });

  it("shows back exactly what was stored", () => {
    expect(formatMoney(1000, "JPY", "en")).toBe("¥1,000");
    expect(formatMoney(1999, "USD", "en")).toBe("$19.99");
    expect(formatMoney(9999, "JOD", "en")).toContain("9.999");
  });

  it("does not invent a fraction the currency has no name for", () => {
    // "¥1,000.00" is not a price anyone in Japan has ever written.
    expect(formatMoney(1000, "JPY", "en")).not.toContain(".");
    expect(formatMoney(1234, "KRW", "en")).not.toContain(".");
  });

  it("round-trips every currency in the table", () => {
    for (const { code } of CURRENCIES) {
      const typed = "1234";
      const stored = moneyToCents(typed, code);
      expect(stored, code).toBe(1234 * minorPerMajor(code));
    }
  });
});

describe("the Stripe handoff", () => {
  it("leaves ordinary amounts alone", () => {
    expect(toStripeAmount(1999, "USD")).toBe(1999);
    expect(toStripeAmount(1000, "JPY")).toBe(1000);
  });

  it("rounds three-decimal amounts to a multiple of ten", () => {
    /*
     * Stripe rejects anything else on these currencies, and it rejects it
     * after accepting every line item — so a seller pricing at 9.999 JOD
     * would see a checkout that fails with nothing to diagnose.
     */
    expect(toStripeAmount(9999, "JOD")).toBe(10000);
    expect(toStripeAmount(1234, "KWD")).toBe(1230);
    expect(toStripeAmount(9999, "JOD") % 10).toBe(0);
  });

  it("rounds every three-decimal currency, not just the one that was tested", () => {
    for (const code of ["JOD", "KWD", "BHD", "OMR", "TND"]) {
      expect(toStripeAmount(1234, code) % 10, code).toBe(0);
    }
  });
});

describe("what a shop is allowed to store", () => {
  it("accepts a code from the table", () => {
    expect(isCurrencyCode("ILS")).toBe(true);
    expect(isCurrencyCode("ils")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "US", "USDD", "'; drop table shops--", null, 42, {}]) {
      expect(isCurrencyCode(bad), String(bad)).toBe(false);
    }
  });

  it("falls back rather than storing a code nothing can format", () => {
    expect(toCurrencyCode("nonsense")).toBe("USD");
    expect(toCurrencyCode("eur")).toBe("EUR");
  });
});

describe("the picker's labels", () => {
  it("names the currency in the reader's language", () => {
    expect(currencyLabel("JPY", "en")).toContain("Japanese");
    expect(currencyLabel("JPY", "fr")).toContain("japonais");
  });

  it("keeps the code in front, because that is what a seller recognises", () => {
    expect(currencyLabel("ILS", "en").startsWith("ILS")).toBe(true);
  });

  it("falls back to the bare code rather than rendering nothing", () => {
    expect(currencyLabel("USD", "not a locale")).toContain("USD");
  });
});

describe("parseMoneyToCents", () => {
  it("carries the currency through, like its nullable twin", () => {
    // The form-field variant answers 0 for unusable text, but it must not
    // also lose the decimal count on the way.
    expect(parseMoneyToCents("1000", "JPY")).toBe(1000);
    expect(parseMoneyToCents("10.00", "USD")).toBe(1000);
  });
});
