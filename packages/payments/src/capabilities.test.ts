import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { capabilitiesFor, requestCapabilities } from "./capabilities";

/**
 * The two bugs this file exists to prevent, both of which shipped.
 *
 * One: a seller outside the United States was offered nothing but cards,
 * because an Express account only gets a payment method whose capability the
 * platform explicitly requested and only two were ever requested.
 *
 * Two: the three wallets went up in one `accounts.update`, so Stripe refusing
 * Cash App for a German account — "the cashapp_payments capability is not
 * requestable for accounts in DE" — threw away Link in the same breath, a
 * wallet that works there perfectly well.
 */

describe("capabilitiesFor", () => {
  it("always asks for the pair an account cannot take a card without", () => {
    for (const country of ["US", "DE", "GB", "JP", "BR", null]) {
      expect(capabilitiesFor(country)).toEqual(
        expect.arrayContaining(["card_payments", "transfers"]),
      );
    }
  });

  it("asks for Link everywhere, because it is available almost everywhere", () => {
    for (const country of ["US", "DE", "GB", "JP", null]) {
      expect(capabilitiesFor(country)).toContain("link_payments");
    }
  });

  it("keeps the US-only wallets in the US", () => {
    expect(capabilitiesFor("US")).toEqual(
      expect.arrayContaining(["cashapp_payments", "us_bank_account_ach_payments"]),
    );
    for (const country of ["DE", "GB", "JP"]) {
      expect(capabilitiesFor(country)).not.toContain("cashapp_payments");
    }
  });

  it("gives a European seller the European set", () => {
    // Not only the method their own country is named after: a German shop with
    // Dutch customers is the ordinary case, and it is the *seller's* account
    // that needs `ideal_payments` for that buyer to see iDEAL.
    expect(capabilitiesFor("DE")).toEqual(
      expect.arrayContaining([
        "sepa_debit_payments",
        "ideal_payments",
        "bancontact_payments",
        "p24_payments",
        "eps_payments",
      ]),
    );
  });

  it("adds the domestic-only rails to the country that has them", () => {
    expect(capabilitiesFor("GB")).toContain("bacs_debit_payments");
    expect(capabilitiesFor("PL")).toContain("blik_payments");
    expect(capabilitiesFor("DE")).not.toContain("blik_payments");
    expect(capabilitiesFor("DE")).not.toContain("bacs_debit_payments");
  });

  it("asks a US seller for nothing European", () => {
    // Stripe accepts the request and leaves it inactive for ever, so this is
    // not an error — it is onboarding questions bought for no payments.
    expect(capabilitiesFor("US")).not.toContain("sepa_debit_payments");
    expect(capabilitiesFor("US")).not.toContain("ideal_payments");
  });

  it("is case-insensitive about the country", () => {
    expect(capabilitiesFor("de")).toEqual(capabilitiesFor("DE"));
  });

  it("falls back to what is safe everywhere when the country is unknown", () => {
    const unknown = capabilitiesFor(null);
    expect(unknown).toEqual(["card_payments", "transfers", "link_payments"]);
  });

  it("never asks for a rail that was deliberately excluded", () => {
    // Klarna and friends decide eligibility on an MCC that `business_profile`
    // does not set; PayPal is unobtainable on direct charges at all.
    for (const country of ["US", "DE", "GB", "SE"]) {
      const wanted = capabilitiesFor(country);
      for (const never of [
        "klarna_payments",
        "affirm_payments",
        "afterpay_clearpay_payments",
        "paypal_payments",
      ]) {
        expect(wanted).not.toContain(never);
      }
    }
  });
});

/** A Stripe double that refuses exactly the capabilities it is told to. */
function stripeRefusing(...refuse: string[]) {
  const update = vi.fn(async (_id: string, params: { capabilities: object }) => {
    const asked = Object.keys(params.capabilities);
    const bad = asked.find((name) => refuse.includes(name));
    if (bad) throw new Error(`The ${bad} capability is not requestable for accounts in DE.`);
    return {};
  });
  return { stripe: { accounts: { update } } as unknown as Stripe, update };
}

describe("requestCapabilities", () => {
  it("sends one request when nothing is refused", () => {
    const { stripe, update } = stripeRefusing();
    return requestCapabilities(stripe, "acct_1", ["a", "b", "c"]).then((outcome) => {
      expect(update).toHaveBeenCalledTimes(1);
      expect(outcome.requested).toEqual(["a", "b", "c"]);
      expect(outcome.refused).toEqual([]);
    });
  });

  it("does not let one refusal cost the others", async () => {
    // The whole reason this function exists. Cash App is refused in Germany;
    // Link is not, and used to be lost anyway because they shared a request.
    const { stripe } = stripeRefusing("cashapp_payments");
    const outcome = await requestCapabilities(stripe, "acct_1", [
      "link_payments",
      "cashapp_payments",
      "us_bank_account_ach_payments",
    ]);

    expect(outcome.requested).toEqual(["link_payments", "us_bank_account_ach_payments"]);
    expect(outcome.refused.map((r) => r.name)).toEqual(["cashapp_payments"]);
  });

  it("retries one at a time only after the batch fails", async () => {
    const { stripe, update } = stripeRefusing("bad");
    await requestCapabilities(stripe, "acct_1", ["good", "bad"]);
    // One failed batch, then one call per capability.
    expect(update).toHaveBeenCalledTimes(3);
  });

  it("never throws, whatever Stripe says", async () => {
    const { stripe } = stripeRefusing("a", "b");
    const outcome = await requestCapabilities(stripe, "acct_1", ["a", "b"]);
    expect(outcome.requested).toEqual([]);
    expect(outcome.refused).toHaveLength(2);
  });

  it("does nothing at all for an empty set", async () => {
    const { stripe, update } = stripeRefusing();
    await requestCapabilities(stripe, "acct_1", []);
    expect(update).not.toHaveBeenCalled();
  });
});
