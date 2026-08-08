import { describe, expect, it } from "vitest";
import {
  centsToAmount,
  formatAddress,
  isUuid,
  formatMoney,
  normalizePhone,
  parseMoneyToCents,
  slugify,
} from "./utils";

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

  it("punctuates a price the way the page around it is written", () => {
    /*
     * The bug this closes was invisible in English and wrong everywhere else:
     * every price on every storefront was formatted `en-US`. A German reader
     * sees `1.234` as one thousand two hundred, so this was not only a matter
     * of taste.
     */
    /*
     * Spaces normalised before comparing. `Intl` separates an amount from its
     * symbol with U+00A0 (and French groups thousands with U+202F), which is
     * correct — those must not wrap — but pasting invisible characters into a
     * test makes a failure unreadable, as this one was when first written.
     */
    const spaced = (s: string) => s.replace(/[\s  ]/g, " ");

    expect(spaced(formatMoney(123456, "EUR", "de"))).toBe("1.234,56 €");
    expect(spaced(formatMoney(123456, "EUR", "en"))).toBe("€1,234.56");
    // Symbol placement moves too, not just the separators.
    expect(spaced(formatMoney(123456, "EUR", "fr"))).toBe("1 234,56 €");
  });

  it("keeps the digits Latin, in every language", () => {
    /*
     * Arabic would otherwise render ١٬٢٣٤٫٥٦ — correct by the standard, and a
     * change no seller asked for. `-u-nu-latn` pins the numerals while leaving
     * the separators, the symbol and the RTL marks alone.
     */
    for (const locale of ["ar", "fa", "hi", "th", "bn"]) {
      expect(formatMoney(123456, "USD", locale), locale).toMatch(/1[,.  ]?234/);
    }
  });

  it("defaults to English rather than to whatever the machine is set to", () => {
    // The staff panel and the chart screenshot baseline both rely on this: a
    // server's own locale must never decide what a page renders.
    expect(formatMoney(123456, "EUR")).toBe(formatMoney(123456, "EUR", "en-US"));
  });

  it("falls back rather than throwing on a locale it cannot parse", () => {
    expect(() => formatMoney(1000, "USD", "not a locale")).not.toThrow();
    expect(formatMoney(1000, "USD", "not a locale")).toContain("USD");
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

/**
 * Money as a human typed it.
 *
 * Sailo ships in 22 languages and both separator conventions are in daily use.
 * This used to strip everything but digits and a dot, so "12,5" — an ordinary
 * way to write €12.50 — became €125. A seller pricing in euros, lira, reais or
 * rupiah overcharged by a factor of ten with no validation message, while the
 * tax-rate field beside it already read the same string as 12.5.
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
describe("isUuid", () => {
  it("accepts a real uuid in either case", () => {
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isUuid("A1B2C3D4-E5F6-7890-ABCD-EF1234567890")).toBe(true);
  });

  it("refuses what Postgres would raise on", () => {
    for (const value of [
      "x",
      "",
      "not-a-uuid",
      "00000000-0000-0000-0000-00000000000",
      "00000000-0000-0000-0000-0000000000000",
      "00000000_0000_0000_0000_000000000000",
      "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
      " 00000000-0000-0000-0000-000000000000",
    ]) {
      expect(isUuid(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("refuses a non-string without being coerced first", () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(isUuid(value)).toBe(false);
    }
  });
});
