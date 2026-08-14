import { currencyDecimals, formatMoney } from "@sailo/core/currency";

/**
 * Money, as the phone renders it.
 *
 * Every screen that shows a price — the order list, the order total, the
 * product row, the variant table — calls `formatMoney` from
 * `@sailo/core/currency`. It is shared code and it is tested here rather than
 * only in the package because the phone is where getting it wrong costs money:
 * a seller confirms an order from a bus stop against a number this function
 * produced, and a wrong one is a real refund, not a rendering bug.
 *
 * WHAT THESE PIN, AND WHY EACH ONE IS A BUG THAT HAS ACTUALLY HAPPENED
 *
 * Amounts arrive as integer minor units on every column the app reads —
 * `totalCents`, `unitPriceCents`, `priceCents`. The single most expensive
 * mistake available is dividing by 100 unconditionally, which is exactly what
 * a hand-rolled formatter does and what this one exists to prevent.
 *
 * These assert the behaviour under Node's ICU, which is what Jest runs. Hermes
 * ships a narrower one, and the divergence is the whole reason the function
 * has a fallback at all — the last case here is the one that covers it.
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

describe("two-decimal currencies", () => {
  it("drops the fraction on a whole amount", () => {
    expect(formatMoney(2000, "USD", "en-US")).toBe("$20");
  });

  it("shows both places when there is a remainder", () => {
    expect(formatMoney(2050, "USD", "en-US")).toBe("$20.50");
  });

  /*
   * Zero is a real total — a fully discounted order — and has to read as one
   * rather than as an empty cell.
   */
  it("renders a zero total", () => {
    expect(formatMoney(0, "USD", "en-US")).toBe("$0");
  });

  /*
   * Refunds are carried as their own positive column, but nothing stops a
   * negative reaching a formatter, and "-$20.50" is a great deal clearer than
   * a crash.
   */
  it("renders a negative amount", () => {
    expect(formatMoney(-2050, "USD", "en-US")).toBe("-$20.50");
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
