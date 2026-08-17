import { describe, expect, it } from "vitest";
import { scrub } from "./pii";

/**
 * The PII policy, which had no test in either of the two places it was written.
 *
 * This is the last thing standing between a seller's customer list and a
 * third-party error tracker. It is also the kind of function that looks obviously
 * correct and fails on the one input nobody pictured — a key named `customerName`
 * rather than `name`, a nested object holding the whole order.
 */

describe("scrub", () => {
  it("keeps what identifies a report rather than a person", () => {
    expect(scrub({ scope: "checkout", shopId: "abc", attempt: 2 })).toEqual({
      scope: "checkout",
      shopId: "abc",
      attempt: 2,
    });
  });

  it("drops every field whose name suggests a person typed it", () => {
    const out = scrub({
      email: "a@b.com",
      phone: "+15551234",
      address: "1 Main St",
      name: "Ada",
      handle: "ada-shop",
      token: "tok_live_1",
      secret: "sh_1",
      password: "hunter2",
      card: "4242424242424242",
      scope: "orders",
    });
    expect(out).toEqual({ scope: "orders" });
  });

  /*
   * Substring matching, and it has to be: the fields Sailo actually attaches are
   * named `customerEmail`, `buyerName`, `shippingAddress`, `cardLast4`. A policy
   * that only matched an exact `email` would pass this suite and leak in
   * production.
   */
  it("matches a key that contains a personal word, not only one that equals it", () => {
    const out = scrub({
      customerEmail: "a@b.com",
      buyerName: "Ada",
      shippingAddress: "1 Main St",
      cardLast4: "4242",
      accessToken: "tok",
      SHOP_HANDLE: "ada",
      count: 3,
    });
    expect(out).toEqual({ count: 3 });
  });

  /*
   * A nested value is where a cart, an order or a customer record arrives, and
   * the keys inside it are not inspected at all — so the whole value goes. This
   * pins that as deliberate: a recursive scrub that missed one level would be
   * worse than dropping the branch.
   */
  it("drops objects and arrays entirely rather than walking into them", () => {
    expect(scrub({ order: { buyerEmail: "a@b.com" }, items: ["x"], scope: "s" })).toEqual({
      scope: "s",
    });
  });

  it("truncates a long string, which is how content escapes one character at a time", () => {
    const out = scrub({ message: "x".repeat(500) });
    expect((out.message as string).length).toBe(200);
  });

  it("keeps a false and a zero, which are answers and not absences", () => {
    // `if (value)` here would drop the two values a bug report most often turns on.
    expect(scrub({ retried: false, attempt: 0 })).toEqual({ retried: false, attempt: 0 });
  });

  it("keeps an explicit null, which says the field was checked and empty", () => {
    expect(scrub({ shopId: null })).toEqual({ shopId: null });
  });

  it("drops undefined, which says nothing at all", () => {
    expect(scrub({ shopId: undefined })).toEqual({});
  });

  it("survives no context, which is most captures", () => {
    expect(scrub(undefined)).toEqual({});
  });
});
