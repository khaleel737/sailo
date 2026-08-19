import { describe, expect, it } from "vitest";
import {
  assemblePlatformEvidence,
  contestDecision,
  platformCe3Identity,
  platformFieldsFor,
  usageGapsIn,
  type PlatformHoldings,
} from "./platform";

/**
 * Sailo answering a chargeback against its own subscription revenue. Spec 46.
 *
 * Two things carry this file, and they pull in opposite directions — which is
 * why both need pinning:
 *
 *   **The case is usually winnable and Sailo was submitting nothing.** A SaaS
 *   subscription is among the most defensible things there is: signup address,
 *   terms acceptance, sign-in history, real usage. Every one of those has a test
 *   here that fails if it stops reaching the payload.
 *
 *   **And sometimes the seller is right, in which case we refund.** That is the
 *   rule spec 46 calls the one that matters most, and it is the one a desk under
 *   time pressure will talk itself out of. `contestDecision` is where it lives
 *   and it is asserted from both directions.
 */

const holdings = (over: Partial<PlatformHoldings> = {}): PlatformHoldings => ({
  accountEmail: "ada@example.com",
  accountName: "Ada Lovelace",
  shopHandle: "adas-ceramics",
  shopName: "Ada's Ceramics",

  signupAt: new Date("2026-01-04T09:00:00.000Z"),
  signupIp: "203.0.113.7",
  signupUserAgent: "Mozilla/5.0",
  signupCountry: "PT",

  termsAcceptedAt: new Date("2026-01-04T09:00:05.000Z"),
  termsText: "Sailo's terms, as they stood.",
  termsCapturedAt: new Date("2026-01-01T00:00:00.000Z"),

  plan: "business",
  subscriptionStatus: "active",
  subscriptionInterval: "month",
  currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
  cancelAtPeriodEndSetAt: null,
  planChanges: [],

  chargedAt: new Date("2026-08-01T00:00:00.000Z"),
  amountCents: 4900,
  currency: "usd",
  statementDescriptor: "SAILO",
  receiptSentTo: "ada@example.com",
  receiptBounced: false,

  signins: [
    { at: new Date("2026-08-03T10:00:00.000Z"), ip: "203.0.113.7", country: "PT", city: "Lisbon" },
  ],
  usage: [
    { day: "2026-08-02", signins: 3, ordersProcessed: 11, storefrontViews: 240, adminActions: 9 },
    { day: "2026-08-03", signins: 1, ordersProcessed: 4, storefrontViews: 120, adminActions: 2 },
  ],
  usageGaps: [],

  claimedCancelledAt: null,
  duplicateInvoiceId: null,
  refundOwedUnprocessed: false,
  ...over,
});

/* -------------------------------------------------------------------------- */

describe("the three questions", () => {
  it("contests a subscription that was used and never cancelled", () => {
    const decision = contestDecision(holdings());
    expect(decision.verdict).toBe("contest");
    expect(decision.questions).toHaveLength(3);
  });

  it("refuses to contest a cancellation that did not work", () => {
    /*
     * THE RULE THAT MATTERS MOST.
     *
     * They asked us to stop, we billed anyway, and they did not use what we
     * billed for. That is our bug wearing a chargeback's clothes: contesting it
     * is dishonest *and* a loss — the fee is spent, the case is lost, and a loss
     * lands on the platform account's own rate.
     */
    const decision = contestDecision(
      holdings({
        cancelAtPeriodEndSetAt: new Date("2026-07-20T00:00:00.000Z"),
        usage: [
          { day: "2026-08-02", signins: 0, ordersProcessed: 0, storefrontViews: 0, adminActions: 0 },
        ],
        signins: [],
      }),
    );
    expect(decision.verdict).toBe("refund");
    expect(decision.headline).toMatch(/our bug/i);
  });

  it("still contests a cancellation followed by use", () => {
    // They cancelled, we billed, and then they went on using it. That is the
    // case worth arguing, and the usage is the argument.
    const decision = contestDecision(
      holdings({ cancelAtPeriodEndSetAt: new Date("2026-07-20T00:00:00.000Z") }),
    );
    expect(decision.verdict).toBe("contest");
  });

  it("refuses outright when we owed a refund and did not process it", () => {
    const decision = contestDecision(holdings({ refundOwedUnprocessed: true }));
    expect(decision.verdict).toBe("refund");
    expect(decision.headline).toMatch(/refund and stop/i);
  });

  it("treats an inquiry as an inquiry", () => {
    // No money has moved, so the downgrade must not fire and the desk should
    // answer rather than contest.
    const decision = contestDecision(holdings(), { isInquiry: true });
    expect(decision.verdict).toBe("inquiry_only");
    expect(decision.headline).toMatch(/downgrade must not fire/i);
  });

  it("never reads a missing usage row as evidence against us", () => {
    /*
     * "We did not measure" is not "they did not use it". A desk shown the second
     * when the first is true talks itself out of a case it should have made.
     */
    const decision = contestDecision(
      holdings({ usage: [], usageGaps: ["2026-08-01", "2026-08-02"] }),
    );
    const usage = decision.questions[1];
    expect(usage?.favours).toBe("unknown");
    expect(usage?.answer).toMatch(/not the same as no use/i);
  });

  it("counts a bounced receipt against us, and says so", () => {
    const decision = contestDecision(holdings({ receiptBounced: true }));
    expect(decision.questions[2]?.favours).toBe("them");
  });
});

/* -------------------------------------------------------------------------- */

describe("the submission", () => {
  it.each([
    "subscription_canceled",
    "unrecognized",
    "fraudulent",
    "product_not_received",
    "credit_not_processed",
  ])("resolves every required field for %s", (reason) => {
    const evidence = assemblePlatformEvidence(reason, holdings());
    const missing = evidence.fields.filter(
      (field) => field.required && field.status === "missing",
    );
    expect(missing.map((field) => field.field)).toEqual([]);
    expect(evidence.completenessBp).toBe(10_000);
  });

  it("resolves a duplicate case only when there is a second invoice to name", () => {
    /*
     * `duplicate` is the one reason whose required set can genuinely be
     * unfillable, and reporting that honestly is the point: a case with no
     * second invoice has nothing to name, and inventing one would offer Visa an
     * invoice number that does not describe a duplicate. The explanation field
     * still says so in words.
     */
    const without = assemblePlatformEvidence("duplicate", holdings());
    expect(
      without.fields.find((field) => field.field === "duplicate_charge_id")?.status,
    ).toBe("missing");
    expect(without.payload.duplicate_charge_explanation).toMatch(
      /no second invoice covers this period/i,
    );

    const withOne = assemblePlatformEvidence(
      "duplicate",
      holdings({ duplicateInvoiceId: "in_1234" }),
    );
    expect(withOne.completenessBp).toBe(10_000);
    expect(withOne.payload.duplicate_charge_id).toBe("in_1234");
    // And it says plainly that a real duplicate is our error to refund.
    expect(withOne.payload.duplicate_charge_explanation).toMatch(/refunded rather than contested/);
  });

  it("offers no field a subscription can never fill", () => {
    /*
     * No shipping, no service documentation, no customer signature. Offering a
     * slot Sailo can never fill would show a permanently incomplete panel on a
     * case that is actually complete, which teaches the desk to ignore the
     * number.
     */
    for (const reason of ["subscription_canceled", "fraudulent", "general"]) {
      const fields = platformFieldsFor(reason);
      expect(fields).not.toContain("shipping_documentation");
      expect(fields).not.toContain("shipping_tracking_number");
      expect(fields).not.toContain("customer_signature");
    }
  });

  it("answers a reason nobody has met with the general set", () => {
    // Stripe's own type is `string`, not a union — the API telling us it adds
    // reason codes. A dispute on one must still produce a submission.
    const evidence = assemblePlatformEvidence("something_new", holdings());
    expect(evidence.payload.uncategorized_text).toBeTruthy();
  });

  it("prints the access log as sign-ins, not downloads", () => {
    const evidence = assemblePlatformEvidence("product_not_received", holdings());
    expect(evidence.payload.access_activity_log).toMatch(/signed in from 203\.0\.113\.7/);
  });

  it("labels a usage gap as a gap and never as a zero", () => {
    /*
     * A false zero submitted to an issuer argues Sailo's own case against it —
     * the platform-side form of "never state a fact Sailo does not hold".
     */
    const evidence = assemblePlatformEvidence(
      "subscription_canceled",
      holdings({ usageGaps: ["2026-07-30"] }),
    );
    expect(evidence.payload.access_activity_log).toMatch(
      /2026-07-30 — no usage record was written/,
    );
  });

  it("states plainly that no cancellation was received when none was", () => {
    const evidence = assemblePlatformEvidence("subscription_canceled", holdings());
    expect(evidence.payload.cancellation_rebuttal).toMatch(/No cancellation was ever received/);
  });

  it("does not claim a cancellation was absent when it was not", () => {
    const evidence = assemblePlatformEvidence(
      "subscription_canceled",
      holdings({ cancelAtPeriodEndSetAt: new Date("2026-08-15T00:00:00.000Z") }),
    );
    expect(evidence.payload.cancellation_rebuttal).toMatch(/Cancellation was set on 2026-08-15/);
    expect(evidence.payload.cancellation_rebuttal).not.toMatch(/never received/);
  });

  it("discloses a bounced receipt in the narrative", () => {
    // Hiding it is the overstatement that loses a case on the point it hid.
    const evidence = assemblePlatformEvidence(
      "unrecognized",
      holdings({ receiptBounced: true }),
    );
    expect(evidence.payload.uncategorized_text).toMatch(/bounced/);
  });

  it("names the statement descriptor, which is what `unrecognized` turns on", () => {
    const evidence = assemblePlatformEvidence("unrecognized", holdings());
    expect(evidence.payload.uncategorized_text).toMatch(/"SAILO"/);
  });

  it("reports a gap rather than inventing a fact for a sparse account", () => {
    // An account that predates `account_events` has no signup row at all.
    const evidence = assemblePlatformEvidence(
      "fraudulent",
      holdings({ signupIp: null, signupAt: null, termsAcceptedAt: null }),
    );
    const ip = evidence.fields.find((field) => field.field === "customer_purchase_ip");
    expect(ip?.status).toBe("missing");
    expect(evidence.hasGaps).toBe(true);
    // And it still produces a submission: gaps beat no answer.
    expect(Object.keys(evidence.payload).length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("usage gaps", () => {
  it("names every day the rollup did not write", () => {
    const gaps = usageGapsIn(
      new Date("2026-08-01T12:00:00.000Z"),
      new Date("2026-08-04T12:00:00.000Z"),
      ["2026-08-02"],
    );
    expect(gaps).toEqual(["2026-08-01", "2026-08-03", "2026-08-04"]);
  });

  it("is empty when every day is on record", () => {
    const gaps = usageGapsIn(
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-02T00:00:00.000Z"),
      ["2026-08-01", "2026-08-02"],
    );
    expect(gaps).toEqual([]);
  });
});

describe("CE3.0 on the platform side", () => {
  it("matches on what a subscription charge actually has", () => {
    const identity = platformCe3Identity(holdings());
    expect(identity.accountId).toBe("adas-ceramics");
    expect(identity.email).toBe("ada@example.com");
    expect(identity.purchaseIp).toBe("203.0.113.7");
  });

  it("invents neither a device nor a shipping address", () => {
    /*
     * A subscription charge is taken from a card on file by a scheduled job with
     * no browser in the loop. Claiming either would be inventing a data point
     * for Visa, on Sailo's own submission.
     */
    const identity = platformCe3Identity(holdings());
    expect(identity.deviceFingerprint).toBeNull();
    expect(identity.shippingAddress).toBeNull();
  });
});
