import { describe, expect, it } from "vitest";
import { currencyDecimals } from "./codes";
import { formatMoney, priceToText } from "./format";

/**
 * Minor units, as a person reads them.
 *
 * WHERE THESE CAME FROM
 *
 * Two suites, testing one function in two places. `core/money/currency-parsing.test.ts`
 * covered locales and fallbacks; `apps/mobile/tests/money.test.tsx` covered the
 * zero- and three-decimal currencies. Neither knew about the other, and between
 * them they had a hole big enough to hide the bug that prompted this merge:
 * the phone shipped its *own* `formatMoney` in `components/money.ts`, so the
 * mobile suite — which imported the package's — passed while half the app's
 * screens ran the other one.
 *
 * A test that imports a different implementation from the one the app runs is
 * worse than no test. Both are here now, beside the only implementation.
 *
 * These assert Node's ICU, which is what vitest runs. Hermes ships a narrower
 * one; the divergence is why the function has a fallback at all, and the last
 * block covers it.
 */

/**
 * The same string with every flavour of Unicode space flattened to an ASCII
 * one.
 *
 * ICU separates a symbol from its number with a non-breaking space (U+00A0),
 * and in some locales a narrow one (U+202F) — which is right, because a price
 * must never wrap between the digits and the currency. It is also invisible in
 * a diff, so an assertion written against it looks identical to one written
 * against a plain space and fails anyway. Worse, which one ICU picks changes
 * between versions, so pinning the exact codepoint makes the suite fail on a
 * Node upgrade rather than on a bug.
 *
 * What these tests are about is the number and the symbol. The kind of space
 * between them is the formatter's business.
 */
const plain = (value: string) => value.replace(/[    ]/g, " ");

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

describe("zero-decimal currencies", () => {
  /*
   * ¥1,000 is a thousand minor units, not a hundred thousand. Divided by a
   * flat 100 this reads ¥10 — a hundredth of what the seller charged, on the
   * screen they use to decide whether an order is worth posting.
   */
  it("renders yen as whole units, not hundredths", () => {
    expect(formatMoney(1000, "JPY", "en-US")).toBe("¥1,000");
    expect(formatMoney(1000, "JPY", "en-US")).not.toContain("10.00");
  });

  it("knows yen has no minor unit at all", () => {
    expect(currencyDecimals("JPY")).toBe(0);
  });

  /*
   * The same integer in two currencies must not produce the same major
   * number. This is the assertion that fails the moment somebody reintroduces
   * a flat divisor.
   */
  it("reads the same integer differently per currency", () => {
    expect(formatMoney(1000, "JPY", "en-US")).not.toBe(formatMoney(1000, "USD", "en-US"));
  });
});

describe("three-decimal currencies", () => {
  /*
   * A dinar has three places. Rendered with two, 1.234 becomes 1.23 and the
   * seller is quoting a price they cannot actually charge.
   */
  it("renders a dinar to three places", () => {
    expect(currencyDecimals("KWD")).toBe(3);
    expect(plain(formatMoney(1234, "KWD", "en-US"))).toBe("KWD 1.234");
  });

  it("keeps all three places on an amount with a remainder", () => {
    expect(plain(formatMoney(1200, "KWD", "en-US"))).toBe("KWD 1.200");
  });

  /*
   * A whole dinar drops the fraction, the same rule as a whole dollar — the
   * branch is on the remainder, not on the currency.
   */
  it("drops the fraction on a whole dinar", () => {
    expect(plain(formatMoney(1000, "KWD", "en-US"))).toBe("KWD 1");
  });
});

describe("across locales", () => {
  it("places the symbol and separator the way each locale writes them", () => {
    expect(plain(formatMoney(2000, "EUR", "de-DE"))).toBe("20 €");
    expect(plain(formatMoney(2050, "EUR", "fr-FR"))).toBe("20,50 €");
  });

  /*
   * Latin digits, in every locale, and deliberately: the formatter asks for
   * them with `-u-nu-latn`. An Arabic-reading seller reconciling against
   * Stripe, a bank statement or a buyer's screenshot is comparing digits, and
   * eastern-Arabic numerals turn a two-second check into a transcription.
   */
  it("keeps digits Latin in an Arabic locale", () => {
    const arabic = formatMoney(24000, "AED", "ar");
    expect(arabic).toContain("240");
    expect(arabic).not.toMatch(/[٠-٩]/);
  });

  it("agrees on the number across locales, differing only in presentation", () => {
    for (const locale of ["en-US", "de-DE", "ar", "ja-JP"]) {
      expect(formatMoney(1000, "JPY", locale)).toMatch(/1[,.٬  ]?000/);
    }
  });
});

describe("when the runtime cannot format it", () => {
  /*
   * The reason the function has a `try` at all. Hermes' ICU is narrower than
   * Node's and an unrecognised code throws rather than degrading — and a
   * crashed screen tells the seller nothing, where a bare number beside its
   * code is still a truthful price they can act on.
   *
   * `"US"` is not a currency code, so it takes that path here.
   */
  it("falls back to a plain number and the code, rather than throwing", () => {
    expect(() => formatMoney(2000, "US", "en-US")).not.toThrow();
    expect(formatMoney(2000, "US", "en-US")).toBe("20.00 US");
  });

  /*
   * An unknown-but-well-formed code still gets two places, which is the right
   * guess: almost every currency has them, and the alternative is rendering
   * nothing.
   */
  it("assumes two places for a currency it has never heard of", () => {
    expect(currencyDecimals("ZZZ")).toBe(2);
  });
});

describe("priceToText", () => {
  /*
   * The editor's opening value. It had no test at all, in either package —
   * `textToPrice`, `priceToText` and `decimalSeparator` lived in
   * `apps/mobile/components/money.ts`, which had no test file, and the mobile
   * suite next to it tested only the formatter.
   *
   * This is the round trip that matters: a seller opens a product, touches
   * nothing, presses Save. Whatever `priceToText` writes, `textToPrice` has to
   * read back as the same integer, in every currency and every locale.
   */
  it("opens a price without a spurious fraction", () => {
    expect(priceToText(1000, "JPY", "en-US")).toBe("1000");
    expect(priceToText(1999, "USD", "en-US")).toBe("19.99");
    expect(priceToText(1234, "KWD", "en-US")).toBe("1.234");
  });

  it("writes the separator the seller's locale uses", () => {
    expect(priceToText(1999, "USD", "de-DE")).toBe("19,99");
    expect(priceToText(1999, "USD", "fr-FR")).toBe("19,99");
  });

  it("never groups thousands, because the field is about to be parsed", () => {
    // "1,234.56" typed back into a number input is not a number.
    expect(priceToText(123456, "USD", "en-US")).toBe("1234.56");
  });

  it("keeps the digits Latin, so the keypad and the field agree", () => {
    expect(priceToText(1999, "AED", "ar")).not.toMatch(/[\u0660-\u0669]/);
  });
});
