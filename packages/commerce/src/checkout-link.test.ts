import { describe, expect, it } from "vitest";
import {
  buildCheckoutLink,
  CHECKOUT_PARAMS,
  readCheckoutLink,
} from "./checkout-link";

/**
 * What a link may and may not say.
 *
 * The two assertions that matter most are both about what is *absent*: no
 * parameter sets a price, and no parameter applies a coupon. Everything else
 * is a display value or a narrowing.
 */

const link = (query: string, limits = {}) =>
  readCheckoutLink(new URLSearchParams(query), limits);

describe("no parameter can change a price", () => {
  it("has no price in the vocabulary at all", () => {
    /*
     * Theirs has a custom-price link. A price in a URL is a price from the
     * browser, and *the server re-prices everything* is the invariant the whole
     * checkout rests on — one parameter that set an amount would make every
     * other guard in the pricing path decorative.
     */
    expect(CHECKOUT_PARAMS).not.toContain("price");
    expect(CHECKOUT_PARAMS).not.toContain("amount");
    expect(CHECKOUT_PARAMS).not.toContain("total");
    expect(CHECKOUT_PARAMS).not.toContain("discount");
  });

  it("ignores one silently when somebody tries", () => {
    const parsed = link("price=1&amount=1&total=1&discount=99");
    expect(Object.values(parsed).every((v) => v === null || v === false)).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("99");
  });
});

describe("?coupon= prefills and never applies", () => {
  it("returns a prefill, not an application", () => {
    /*
     * The field is named `couponPrefill` deliberately: there is no shape of
     * this return value that a caller could mistake for "apply this". Auto-
     * applying makes every guess free and turns the storefront into a discount
     * oracle — which is exactly what the submission ceiling exists to price.
     */
    const parsed = link("coupon=save20");
    expect(parsed.couponPrefill).toBe("SAVE20");
    expect(Object.keys(parsed)).not.toContain("couponApplied");
    expect(Object.keys(parsed)).not.toContain("discountCents");
  });

  it("refuses a code that is not one, rather than passing it through", () => {
    for (const bad of ["coupon=", "coupon=a", "coupon=" + "x".repeat(40), "coupon=%3Cscript%3E"]) {
      expect(link(bad).couponPrefill, bad).toBeNull();
    }
  });
});

describe("?qty= clamps and says so", () => {
  it("takes a plain quantity", () => {
    expect(link("qty=3")).toMatchObject({ qty: 3, qtyClamped: false });
  });

  it("narrows to the seller's cap and reports it", () => {
    // Rule 8, no silent caps: a quantity quietly reduced is the seller's
    // campaign selling something other than what the link promised.
    expect(link("qty=12", { maxPerOrder: 3 })).toMatchObject({
      qty: 3,
      qtyClamped: true,
    });
  });

  it("narrows to stock, and reads zero stock as a ceiling", () => {
    expect(link("qty=5", { stock: 2 })).toMatchObject({ qty: 2, qtyClamped: true });
    // `0` is sold out and must not be read as "no limit".
    expect(link("qty=5", { stock: 0 })).toMatchObject({ qty: null, qtyClamped: true });
  });

  it("takes the tighter of the two ceilings", () => {
    expect(link("qty=9", { maxPerOrder: 5, stock: 2 })).toMatchObject({ qty: 2 });
    expect(link("qty=9", { maxPerOrder: 2, stock: 5 })).toMatchObject({ qty: 2 });
  });

  it("never widens", () => {
    // Asking for one when ten are allowed is still one.
    expect(link("qty=1", { maxPerOrder: 10 })).toMatchObject({
      qty: 1,
      qtyClamped: false,
    });
  });

  it("reads only digits as a quantity", () => {
    /*
     * `1e3`, `0x10` and `" 3 "` are all `Number`-parseable and none is
     * something a seller typed into a link.
     */
    for (const bad of ["qty=1e3", "qty=0x10", "qty=-2", "qty=0", "qty=3.5", "qty=abc"]) {
      expect(link(bad).qty, bad).toBeNull();
    }
  });
});

describe("prefills are display values and nothing else", () => {
  it("carries a name and an address through", () => {
    const parsed = link("name=Ada&email=ada%40example.com");
    expect(parsed.name).toBe("Ada");
    expect(parsed.email).toBe("ada@example.com");
  });

  it("flattens anything that would break out of a single-line field", () => {
    // A newline in an input's `defaultValue` is how one pasted value becomes
    // two fields.
    const parsed = readCheckoutLink({ name: "Ada\r\nBcc: someone@else.test" });
    expect(parsed.name).toBe("Ada Bcc: someone@else.test");
    expect(parsed.name).not.toContain("\n");
  });

  it("bounds a very long one", () => {
    expect(readCheckoutLink({ name: "x".repeat(500) }).name).toHaveLength(120);
  });

  it("does not escape — that is the renderer's job", () => {
    /*
     * Escaping here would double-escape and show a buyer `&amp;` in their own
     * name. What this guarantees is that the value is text; React escapes it
     * at the boundary where it becomes markup.
     */
    expect(readCheckoutLink({ name: "Bed & Breakfast" }).name).toBe("Bed & Breakfast");
  });
});

describe("ids and codes", () => {
  it("takes a variant only when it is shaped like one", () => {
    const id = "0f8f2b1c-1234-4a5b-8c9d-abcdefabcdef";
    expect(link(`variant=${id}`).variantId).toBe(id);
    for (const bad of ["variant=1", "variant=../../x", "variant=%3Cscript%3E"]) {
      expect(link(bad).variantId, bad).toBeNull();
    }
  });

  it("takes an affiliate code and refuses punctuation", () => {
    expect(link("ref=ADA-42").ref).toBe("ADA-42");
    expect(link("ref=a b").ref).toBeNull();
  });
});

describe("unknown parameters", () => {
  it("are ignored silently", () => {
    // A seller's analytics tags ride on these URLs; refusing an unknown one
    // would break a link that works everywhere else.
    const parsed = link("utm_source=instagram&fbclid=abc&qty=2");
    expect(parsed.qty).toBe(2);
  });
});

describe("building one", () => {
  it("round-trips through the reader", () => {
    // One place knows what a checkout link looks like, so what a seller copies
    // is a thing the storefront can read.
    const url = buildCheckoutLink("https://sailo.test/ada", {
      variant: "0f8f2b1c-1234-4a5b-8c9d-abcdefabcdef",
      coupon: "SAVE20",
      qty: 2,
      ref: "PARTNER1",
    });
    const parsed = readCheckoutLink(new URL(url).searchParams);
    expect(parsed).toMatchObject({
      variantId: "0f8f2b1c-1234-4a5b-8c9d-abcdefabcdef",
      couponPrefill: "SAVE20",
      qty: 2,
      ref: "PARTNER1",
    });
  });

  it("omits blanks rather than writing empty parameters", () => {
    const url = buildCheckoutLink("https://sailo.test/ada", { qty: 2, name: "", ref: null });
    expect(url).toBe("https://sailo.test/ada?qty=2");
  });
});
