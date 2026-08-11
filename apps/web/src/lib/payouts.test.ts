import { describe, expect, it } from "vitest";
import { isPayoutMethodType, maskPayoutDetails } from "./payouts";

/**
 * The mask is a disclosure control, not a formatter: the portal is reached by
 * a bare link, and what these tests pin down is how much of an account number
 * a stranger holding that link gets to read.
 */

describe("maskPayoutDetails", () => {
  it("keeps an email's first letter and domain, drops the rest", () => {
    expect(maskPayoutDetails("khaleel@example.com")).toBe("k…@example.com");
    expect(maskPayoutDetails("  a.b+shop@pay.io  ")).toBe("a…@pay.io");
  });

  it("keeps the last four characters of anything account-shaped", () => {
    expect(maskPayoutDetails("DE89 3704 0044 0532 0130 00")).toBe("…3000");
    expect(maskPayoutDetails("GB29NWBK60161331926819")).toBe("…6819");
  });

  it("shows nothing of a value too short to part-hide", () => {
    // Last-four of a four-character value is the whole value.
    expect(maskPayoutDetails("1234")).toBe("…");
    expect(maskPayoutDetails("ok")).toBe("…");
  });

  it("treats an @ in first position as not an email", () => {
    // "@handle" is a payment app handle, not an address to split on.
    expect(maskPayoutDetails("@khaleelpays")).toBe("…pays");
  });
});

describe("isPayoutMethodType", () => {
  it("accepts exactly the three methods the form offers", () => {
    expect(isPayoutMethodType("bank")).toBe(true);
    expect(isPayoutMethodType("paypal")).toBe(true);
    expect(isPayoutMethodType("other")).toBe(true);
    expect(isPayoutMethodType("stripe")).toBe(false);
    expect(isPayoutMethodType("")).toBe(false);
  });
});
