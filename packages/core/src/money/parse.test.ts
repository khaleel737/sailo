import { describe, expect, it } from "vitest";
import { centsToAmount, decimalSeparator, parseMoneyToCents, textToCount, textToPrice } from "./parse";
import { priceToText as writePrice } from "./format";

/**
 * Text, as minor units.
 *
 * Two functions do this, on purpose, and the split is by what the caller knows:
 * `parseMoneyToCents` infers the decimal separator from the digits because a CSV
 * importer has no locale to read the file against; `textToPrice` is given one and
 * asks `Intl`. The second is strictly more correct and only sometimes available.
 *
 * The `textToPrice` half had **no test anywhere** before this file. It lived in
 * `apps/mobile/components/money.ts` — no test file beside it — and it is the
 * function that decides what number a seller's product is saved with.
 */

describe("parseMoneyToCents", () => {
  it.each([
    ["29.99", 2999],
    ["$29.99", 2999],
    ["29", 2900],
    ["0", 0],
    ["", 0],
  ])("reads a plain amount: %j → %i", (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it.each([
    ["12,5", 1250],
    ["12,50", 1250],
    ["0,99", 99],
    ["1.299,99", 129_999],
  ])("reads a decimal comma: %j → %i", (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it.each([
    ["1,299.99", 129_999],
    ["1,299", 129_900],
    ["1,234,567", 123_456_700],
    ["1.234.567", 123_456_700],
  ])("reads a thousands separator: %j → %i", (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it("takes the later separator as the decimal point", () => {
    // Grouping always precedes the fraction, in both conventions.
    expect(parseMoneyToCents("1.234,56")).toBe(123_456);
    expect(parseMoneyToCents("1,234.56")).toBe(123_456);
  });

  it("never multiplies a price by a thousand", () => {
    /*
     * The regression this replaces. An earlier version read "exactly three
     * digits after a lone separator" as grouping whichever separator it was,
     * so a seller typing 12.500 for twelve fifty was charged twelve thousand
     * five hundred, and 0.750 became seven hundred and fifty.
     */
    expect(parseMoneyToCents("12.500")).toBe(1250);
    expect(parseMoneyToCents("0.750")).toBe(75);
    expect(parseMoneyToCents("0,750")).toBe(75);
  });

  it("only reads a comma as a group when the lead could be one", () => {
    // "1,299" groups; "0,750" cannot, because no grouped number starts with a
    // lone zero.
    expect(parseMoneyToCents("1,299")).toBe(129_900);
    expect(parseMoneyToCents("0,750")).toBe(75);
  });

  it("keeps a lone dot a decimal point, and says so", () => {
    /*
     * Deliberately asymmetric with the comma rule. A European writing "1.299"
     * for one thousand two hundred and ninety-nine gets 1.30 here, which is
     * wrong — but it is the direction this has always been wrong in, it shows
     * on the page the moment they save, and the alternative multiplies prices
     * by a thousand. Resolving it needs the shop's locale, which the parser
     * is not given. Pinned so the trade-off is a decision, not an accident.
     */
    expect(parseMoneyToCents("1.299")).toBe(130);
  });

  it("passes a number straight through", () => {
    expect(parseMoneyToCents(29.99)).toBe(2999);
    expect(parseMoneyToCents(0)).toBe(0);
  });

  it("never returns a negative amount", () => {
    // A refund form is the caller; a negative there would move money the
    // wrong way.
    expect(parseMoneyToCents("-5")).toBe(0);
    expect(parseMoneyToCents(-5)).toBe(0);
  });

  it.each(["abc", "$", ".", ",", "NaN"])("reads junk as zero: %j", (input) => {
    expect(parseMoneyToCents(input)).toBe(0);
  });
});

/**
 * The other half of the pair, and the half a currency-awareness pass missed.
 *
 * Every edit form in the admin renders a stored amount into a text input and
 * saves whatever comes back through `parseMoneyToCents`. That parser has known
 * each currency's minor unit since seventy-one of them were added; the render
 * side divided by a flat 100 for another two commits. The round-trip test
 * below is the one that fails on that asymmetry — opening a product and
 * pressing Save without typing anything must not change the price, in any
 * currency.
 */

describe("centsToAmount", () => {
  it.each([
    [2999, "USD", "29.99"],
    [1000, "USD", "10.00"],
    [0, "USD", "0.00"],
  ])("renders a two-decimal currency: %i %s → %j", (minor, code, shown) => {
    expect(centsToAmount(minor, code)).toBe(shown);
  });

  it("renders a zero-decimal currency as a whole number", () => {
    // ¥1,000 is a thousand minor units. Divided by 100 it showed "10.00",
    // which saved back as ¥10 — the price cut to a hundredth by a no-op edit.
    expect(centsToAmount(1000, "JPY")).toBe("1000");
    expect(centsToAmount(0, "JPY")).toBe("0");
  });

  it("renders a three-decimal currency to three places", () => {
    // 12.500 KWD. Divided by 100 it showed "125.00", which saved back as
    // 125.000 KWD and charged the buyer ten times the price.
    expect(centsToAmount(12_500, "KWD")).toBe("12.500");
  });

  it("keeps blank blank, because blank is not zero", () => {
    // An empty variant price means "inherit from the product"; 0 means free.
    expect(centsToAmount(null)).toBe("");
    expect(centsToAmount(undefined)).toBe("");
    expect(centsToAmount(0)).toBe("0.00");
  });

  it.each(["USD", "EUR", "JPY", "KWD", "BHD", "ISK", "TND", "CLP"])(
    "round-trips through the parser unchanged in %s",
    (code) => {
      // The property that matters: opening a form and saving it untouched is
      // not allowed to move the price, whatever the currency.
      for (const minor of [0, 1, 999, 1000, 12_500, 123_456]) {
        expect(parseMoneyToCents(centsToAmount(minor, code), code)).toBe(minor);
      }
    },
  );
});

/**
 * The guard between a client-supplied string and a `uuid` column.
 *
 * Postgres raises on a value it cannot parse rather than returning nothing, so
 * a malformed id does not come back empty — it comes back as a 500. Two public
 * unauthenticated endpoints did exactly that until a live run found them:
 * `{"shopId":"x"}` to `/api/track` or `/api/referral` was enough, and every
 * malformed beacon a stale cached page sent would have done it.
 *
 * Takes `unknown` and narrows, because the coercion a `string`-only signature
 * forces at the call site — `isUuid(maybe ?? "")` — is exactly where the check
 * gets written wrong.
 */

describe("decimalSeparator", () => {
  it("answers from the locale rather than from the digits", () => {
    expect(decimalSeparator("en-US")).toBe(".");
    expect(decimalSeparator("de-DE")).toBe(",");
    expect(decimalSeparator("fr-FR")).toBe(",");
    expect(decimalSeparator("ar-AE")).toBeTruthy();
  });

  it("falls back to a dot on a locale it cannot parse", () => {
    // The locale reaches this from a device setting, so it cannot be trusted.
    expect(() => decimalSeparator("not a locale")).not.toThrow();
    expect(decimalSeparator("not a locale")).toBe(".");
  });
});

describe("textToPrice", () => {
  /*
   * The case that justifies the whole locale-aware pair, and the one
   * `parseMoneyToCents` documents itself as getting wrong: a German seller
   * typing "12,50" means twelve fifty. Inferred from the digits alone, a lone
   * comma with two places behind it is ambiguous; given `de-DE` it is not.
   */
  it("reads a comma as a decimal point where that is what it means", () => {
    expect(textToPrice("12,50", "EUR", "de-DE")).toBe(1250);
    expect(textToPrice("12.50", "USD", "en-US")).toBe(1250);
  });

  /*
   * And the mirror: the separator the locale does *not* use is not a decimal
   * point, it is punctuation the seller pasted in. Dropping it is right —
   * "1.299" in de-DE is one thousand two hundred and ninety-nine.
   */
  it("ignores the separator its locale does not use", () => {
    expect(textToPrice("1.299", "EUR", "de-DE")).toBe(129_900);
    expect(textToPrice("1,299", "USD", "en-US")).toBe(129_900);
  });

  it("scales by the currency's minor unit, not by a flat hundred", () => {
    expect(textToPrice("1000", "JPY", "en-US")).toBe(1000);
    expect(textToPrice("1.234", "KWD", "en-US")).toBe(1234);
  });

  it("returns null for what is not a price yet, rather than zero", () => {
    // A field mid-edit. Parsing "12." as 12 fights the keyboard; parsing "" as
    // 0 saves a free product.
    expect(textToPrice("", "USD", "en-US")).toBeNull();
    expect(textToPrice(".", "USD", "en-US")).toBeNull();
    expect(textToPrice("abc", "USD", "en-US")).toBeNull();
  });

  it("refuses a negative, which no product price is", () => {
    expect(textToPrice("-5", "USD", "en-US")).toBe(500);
  });

  /*
   * The round trip, which is the actual production risk: open a product, touch
   * nothing, save. Any disagreement between these two changes a live price.
   */
  it("reads back exactly what priceToText wrote", () => {
    for (const currency of ["USD", "JPY", "KWD", "EUR"]) {
      for (const locale of ["en-US", "de-DE", "fr-FR", "ar"]) {
        for (const minor of [0, 1, 999, 1000, 1999, 123_456]) {
          const text = writePrice(minor, currency, locale);
          expect(textToPrice(text, currency, locale), `${minor} ${currency} ${locale}`).toBe(minor);
        }
      }
    }
  });
});

describe("textToCount", () => {
  it("keeps blank blank, which means not counting stock", () => {
    expect(textToCount("")).toBeNull();
  });

  it("reads a whole number and refuses a fractional one", () => {
    expect(textToCount("12")).toBe(12);
    expect(textToCount("0")).toBe(0);
  });

  it("refuses what is not a count", () => {
    expect(textToCount("abc")).toBeNull();
  });

  /*
   * The tenfold bug, on the fields where it costs the most. Stripping every
   * non-digit read "12.5" as 125 — a booking of two hours instead of twelve
   * minutes, or 125 units of stock the seller does not have.
   */
  it("takes the whole part of a fraction rather than its digits", () => {
    expect(textToCount("12.5")).toBe(12);
    expect(textToCount("12,5")).toBe(12);
    expect(textToCount("0.75")).toBe(0);
  });

  /*
   * Lenient on a minus, on purpose and documented at the function: a number pad
   * cannot type one, so it is a paste, and `null` on a stock field does not mean
   * "invalid" — it means "stop counting".
   */
  it("reads a pasted minus as the number without it", () => {
    expect(textToCount("-3")).toBe(3);
  });
});
