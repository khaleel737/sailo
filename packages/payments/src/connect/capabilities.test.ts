import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  capabilitiesFor,
  classify,
  requestCapabilities,
  type CapabilityFacts,
} from "./capabilities";

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
    //
    // Measured against a sandbox in NL, DE, AT, BE, FR and PL: these three
    // came back `active` in all six.
    expect(capabilitiesFor("DE")).toEqual(
      expect.arrayContaining([
        "sepa_debit_payments",
        "ideal_payments",
        "bancontact_payments",
      ]),
    );
  });

  it("never asks anyone for EPS, which Stripe rejects even in Austria", () => {
    /*
     * `rejected.other` in all six countries tested, its own home included. It
     * arrived as a *successful* `accounts.update` and then sat inactive, so
     * nothing was ever logged and the request went up on every onboarding.
     */
    for (const country of ["AT", "DE", "NL", "FR", "BE", "PL", "US"]) {
      expect(capabilitiesFor(country)).not.toContain("eps_payments");
    }
  });

  it("keeps P24 to Poland, which is the only place it is obtainable", () => {
    // `rejected.unsupported_business` everywhere else, again from a request
    // Stripe accepted.
    expect(capabilitiesFor("PL")).toContain("p24_payments");
    for (const country of ["DE", "NL", "AT", "FR", "BE"]) {
      expect(capabilitiesFor(country)).not.toContain("p24_payments");
    }
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
      expect(outcome.skipped).toEqual([]);
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

/** Facts in the shape `listCapabilities` returns them. */
function facts(over: Partial<CapabilityFacts> & { name: string }): CapabilityFacts {
  return { status: "active", disabledReason: null, currentlyDue: [], ...over };
}

describe("requestCapabilities, against what Stripe already said", () => {
  it("stops asking for a rail Stripe has rejected for good", async () => {
    /*
     * The second of the two shipped bugs. P24 comes back from a *successful*
     * update and settles at `rejected.unsupported_business`, so `refused` was
     * empty and the request went up again on every single page load.
     */
    const { stripe, update } = stripeRefusing();
    const known = new Map([
      [
        "p24_payments",
        facts({
          name: "p24_payments",
          status: "inactive",
          disabledReason: "rejected.unsupported_business",
        }),
      ],
    ]);

    const outcome = await requestCapabilities(
      stripe,
      "acct_1",
      ["ideal_payments", "p24_payments"],
      known,
    );

    expect(outcome.skipped).toEqual(["p24_payments"]);
    expect(outcome.requested).toEqual(["ideal_payments"]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(Object.keys(update.mock.calls[0]![1].capabilities)).toEqual([
      "ideal_payments",
    ]);
  });

  it("still asks for one that is merely inactive, which is not a refusal", async () => {
    // `inactive` with fields outstanding is Stripe waiting on the seller, not
    // Stripe saying no. Skipping it would strand the rail for ever.
    const { stripe } = stripeRefusing();
    const known = new Map([
      [
        "ideal_payments",
        facts({
          name: "ideal_payments",
          status: "inactive",
          disabledReason: "requirements.fields_needed",
          currentlyDue: ["individual.id_number"],
        }),
      ],
    ]);

    const outcome = await requestCapabilities(stripe, "acct_1", ["ideal_payments"], known);
    expect(outcome.requested).toEqual(["ideal_payments"]);
    expect(outcome.skipped).toEqual([]);
  });

  it("does nothing at all when every rail is already rejected", async () => {
    const { stripe, update } = stripeRefusing();
    const known = new Map([
      ["eps_payments", facts({ name: "eps_payments", status: "inactive", disabledReason: "rejected.other" })],
    ]);

    const outcome = await requestCapabilities(stripe, "acct_1", ["eps_payments"], known);
    expect(update).not.toHaveBeenCalled();
    expect(outcome.skipped).toEqual(["eps_payments"]);
  });
});

describe("classify", () => {
  it("calls an active capability live", () => {
    expect(classify(facts({ name: "card_payments" })).state).toBe("live");
  });

  it("separates waiting-on-the-seller from waiting-on-Stripe", () => {
    /*
     * The first of the two shipped bugs, and the whole reason this function
     * exists. iDEAL on a Dutch account is accepted at once and then sits
     * inactive for want of one identity field. Reported as a success, it left
     * every Dutch seller without the rail Dutch buyers expect, and nobody was
     * ever asked for the field.
     */
    const blocked = classify(
      facts({
        name: "ideal_payments",
        status: "inactive",
        disabledReason: "requirements.fields_needed",
        currentlyDue: ["individual.id_number"],
      }),
    );
    expect(blocked.state).toBe("blocked");
    expect(blocked.currentlyDue).toEqual(["individual.id_number"]);

    const pending = classify(
      facts({ name: "ideal_payments", status: "pending", disabledReason: null }),
    );
    expect(pending.state).toBe("pending");
    expect(pending.currentlyDue).toEqual([]);
  });

  it("treats every rejected.* reason as final", () => {
    for (const reason of ["rejected.other", "rejected.unsupported_business"]) {
      expect(
        classify(facts({ name: "eps_payments", status: "inactive", disabledReason: reason })).state,
      ).toBe("unavailable");
    }
  });

  it("does not report a rail nobody asked for as a problem", () => {
    expect(
      classify(facts({ name: "oxxo_payments", status: "unrequested" })).state,
    ).toBe("unavailable");
    expect(classify(undefined).state).toBe("unavailable");
  });
});
