import { describe, expect, it } from "vitest";
import {
  canAccrue,
  canBePaid,
  hasLiveSubscription,
  payoutBlocker,
} from "./eligibility";

/**
 * Who earns, and who gets paid — the two questions the programme turns on.
 *
 * They are deliberately *different* questions and most of this file exists to
 * hold them apart. A partner who cancels stops accruing immediately and is
 * still owed every cent already in the ledger; conflating the two either pays
 * commission to somebody who left, or keeps money we already owe.
 */

const shop = (over: Partial<Parameters<typeof canBePaid>[0]> = {}) => ({
  plan: "pro",
  subscriptionStatus: "active",
  compPlan: null,
  stripeAccountId: "acct_123",
  stripeChargesEnabled: true,
  ...over,
});

describe("hasLiveSubscription", () => {
  it("counts an active paid plan", () => {
    expect(hasLiveSubscription(shop())).toBe(true);
  });

  /*
   * A trial is somebody Stripe is about to charge. Refusing them would mean a
   * partner loses a referral for being fourteen days early.
   */
  it("counts a trial", () => {
    expect(hasLiveSubscription(shop({ subscriptionStatus: "trialing" }))).toBe(true);
  });

  /*
   * `past_due` is the one that matters most. Stripe is still retrying, so the
   * money may yet arrive — but paying commission before it does means paying
   * out of revenue we never received.
   */
  it("does NOT count past_due", () => {
    expect(hasLiveSubscription(shop({ subscriptionStatus: "past_due" }))).toBe(false);
  });

  it("does not count free, cancelled, or missing", () => {
    expect(hasLiveSubscription(shop({ plan: "free" }))).toBe(false);
    expect(hasLiveSubscription(shop({ subscriptionStatus: "canceled" }))).toBe(false);
    expect(hasLiveSubscription(shop({ subscriptionStatus: null }))).toBe(false);
    expect(hasLiveSubscription(null)).toBe(false);
  });

  /*
   * A comped plan is the point of comping somebody: they get the product
   * without paying Stripe, so there is no subscription to be active.
   */
  it("counts a comped plan with no Stripe subscription at all", () => {
    expect(
      hasLiveSubscription({
        plan: "free",
        subscriptionStatus: null,
        compPlan: "business",
      }),
    ).toBe(true);
  });

  it("ignores a comp set to free", () => {
    expect(
      hasLiveSubscription({ plan: "free", subscriptionStatus: null, compPlan: "free" }),
    ).toBe(false);
  });
});

describe("canAccrue", () => {
  it("needs approval and a live subscription together", () => {
    expect(canAccrue("approved", shop())).toBe(true);
    expect(canAccrue("pending", shop())).toBe(false);
    expect(canAccrue("suspended", shop())).toBe(false);
    expect(canAccrue("approved", shop({ plan: "free" }))).toBe(false);
  });

  /*
   * The Stan rule, and the reason this is checked at every `invoice.paid`
   * rather than once at approval: cancelling stops the tap from that moment.
   */
  it("stops the moment the subscription lapses", () => {
    expect(canAccrue("approved", shop({ subscriptionStatus: "canceled" }))).toBe(false);
  });

  it("refuses a partner with no shop", () => {
    expect(canAccrue("approved", null)).toBe(false);
  });
});

describe("canBePaid", () => {
  it("needs a connected, charge-ready Stripe account", () => {
    expect(canBePaid(shop())).toBe(true);
    expect(canBePaid(shop({ stripeAccountId: null }))).toBe(false);
    expect(canBePaid(shop({ stripeChargesEnabled: false }))).toBe(false);
    expect(canBePaid(null)).toBe(false);
  });

  /*
   * **The rule that keeps us honest.** Money already in the ledger was earned
   * under the terms in force when the invoice was paid. Cancelling stops the
   * tap; it does not empty the bucket. If this ever starts testing the
   * subscription, we begin keeping money somebody already earned.
   */
  it("pays a lapsed partner what they are already owed", () => {
    expect(canBePaid(shop({ plan: "free", subscriptionStatus: "canceled" }))).toBe(true);
    expect(canBePaid(shop({ subscriptionStatus: "past_due" }))).toBe(true);
  });
});

describe("payoutBlocker", () => {
  it("names the thing that has to be finished", () => {
    expect(payoutBlocker(shop())).toBeNull();
    expect(payoutBlocker(null)).toBe("no_shop");
    expect(payoutBlocker(shop({ stripeAccountId: null }))).toBe("no_stripe");
    expect(payoutBlocker(shop({ stripeChargesEnabled: false }))).toBe("stripe_incomplete");
  });

  /*
   * The two must never disagree: HQ's "Pay now" button and the payout run both
   * read them, and a partner shown payable by one and refused by the other is
   * a support ticket nobody can answer.
   */
  it("agrees with canBePaid in every case", () => {
    for (const variant of [
      shop(),
      shop({ stripeAccountId: null }),
      shop({ stripeChargesEnabled: false }),
      null,
    ]) {
      expect(payoutBlocker(variant) === null).toBe(canBePaid(variant));
    }
  });
});
