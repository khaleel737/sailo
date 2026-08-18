import { describe, expect, it } from "vitest";
import { presentmentFromSession } from "./presentment";

/**
 * What the buyer's card statement says, when Stripe converted the charge.
 *
 * The thing this must never do is disturb the seller's side. `amount_total`
 * and `currency` on the session stay the shop's whatever the buyer sees — that
 * is Stripe's contract, and it is why Adaptive Pricing is safe to switch on —
 * so nothing here writes a money figure the books use. It records a note about
 * a conversion, and only when one actually happened.
 */

describe("presentmentFromSession", () => {
  it("reads the converted amount a Dutch buyer of a dollar shop paid", () => {
    // The case Adaptive Pricing exists for: iDEAL settles in EUR and nothing
    // else, so this is the only shape in which that buyer is offered it.
    expect(
      presentmentFromSession({
        currency: "usd",
        presentment_details: { presentment_amount: 4123, presentment_currency: "EUR" },
      }),
    ).toEqual({ presentmentCurrency: "eur", presentmentAmountCents: 4123 });
  });

  it("is null when the buyer paid in the shop's own currency", () => {
    /*
     * Stripe populates `presentment_details` on every session once Adaptive
     * Pricing is on, echoing the integration currency back on the ones it did
     * not convert. Recording that would put a "buyer paid" note on an order
     * nobody converted — a support answer to a question nobody asked.
     */
    expect(
      presentmentFromSession({
        currency: "usd",
        presentment_details: { presentment_amount: 4500, presentment_currency: "usd" },
      }),
    ).toBeNull();
  });

  it("compares currencies case-insensitively, because Stripe is not consistent", () => {
    expect(
      presentmentFromSession({
        currency: "USD",
        presentment_details: { presentment_amount: 4500, presentment_currency: "usd" },
      }),
    ).toBeNull();
  });

  it("is null when Stripe reports no presentment at all", () => {
    // Adaptive Pricing switched off at the platform, which is how every
    // session looked before today and how they still look for sellers whose
    // currency is not a settlement currency of their account.
    expect(presentmentFromSession({ currency: "usd" })).toBeNull();
    expect(
      presentmentFromSession({ currency: "usd", presentment_details: undefined }),
    ).toBeNull();
  });

  it("keeps a zero amount, which is a real settlement", () => {
    /*
     * A 100%-off coupon settles for nothing and Stripe reports
     * `no_payment_required`. Zero is a legitimate amount, so this checks the
     * type rather than the truthiness — a `||` here would have dropped it.
     */
    expect(
      presentmentFromSession({
        currency: "usd",
        presentment_details: { presentment_amount: 0, presentment_currency: "eur" },
      }),
    ).toEqual({ presentmentCurrency: "eur", presentmentAmountCents: 0 });
  });
});
