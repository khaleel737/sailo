import { describe, expect, it } from "vitest";
import {
  EVIDENCE_FIELD_MAX,
  EVIDENCE_TEXT_BUDGET,
  assembleEvidence,
  type EvidenceHoldings,
} from "./assemble";
import { EVIDENCE_FILE_FIELDS, EVIDENCE_TEXT_FIELDS, playbookFor } from "./reasons";

/**
 * Building a submission from what is held, and saying what is not.
 *
 * The path nobody exercises until it matters: it runs a handful of times a month
 * against orders whose shape varies more than any other in the product, and a
 * mistake in it is discovered as a lost case and a debited balance sixty days
 * later. So every branch is reachable from plain numbers here.
 */

const HOLDINGS: EvidenceHoldings = {
  customerName: "Ada Lovelace",
  customerEmail: "ada@example.com",
  buyerIp: "203.0.113.42",
  buyerUserAgent: "Mozilla/5.0 (Macintosh)",
  buyerDeviceFingerprint: "fp_c4c9a1e2b7d84f60a3b5",
  buyerAccountId: "client_7f3a",
  billingAddress: "12 Bridge St, Bristol, BS1 4ND, GB",
  shippingAddress: "12 Bridge St, Bristol, BS1 4ND, GB",
  productDescription: "Speckled Mug — Large",
  soldKind: "physical",
  currency: "GBP",
  totalCents: 3_400,
  orderReference: "INV-0007",
  placedAt: new Date("2026-05-02T10:15:00Z"),
  shippingCarrier: "Royal Mail",
  shippingTrackingNumber: "RM123456789GB",
  shippedAt: new Date("2026-05-03T09:00:00Z"),
  serviceAt: null,
  accessLog: [],
  termsAcceptedAt: new Date("2026-05-02T10:14:58Z"),
  refundPolicyText: "Returns within 14 days.",
  refundPolicyUrl: "https://sailo.shop/potters/legal",
  cancellationPolicyText: null,
  refundedCents: 0,
  refundedAt: null,
  refundRefusalExplanation: null,
  duplicateChargeId: null,
  duplicateIsDistinct: false,
  cancelledAt: null,
  customerCommunicationSummary: null,
  files: {},
};

const holdings = (over: Partial<EvidenceHoldings> = {}): EvidenceHoldings => ({
  ...HOLDINGS,
  ...over,
});

describe("a complete physical not-received case", () => {
  const built = assembleEvidence("product_not_received", holdings());

  it("sends the carrier's details, which are what decide it", () => {
    expect(built.payload.shipping_carrier).toBe("Royal Mail");
    expect(built.payload.shipping_tracking_number).toBe("RM123456789GB");
    expect(built.payload.shipping_date).toBe("2026-05-03");
    expect(built.payload.shipping_address).toContain("Bristol");
  });

  it("still reports a gap, because proof of delivery is a file nobody uploaded", () => {
    /*
     * A tracking number is not a delivery. The distinction is the difference
     * between winning and losing a 13.1, so `shipping_documentation` is required
     * and no amount of held text substitutes for it.
     */
    expect(built.hasGaps).toBe(true);
    expect(built.blockedOnSeller).toContain("shipping_documentation");
    const ask = built.fields.find((f) => f.field === "shipping_documentation")?.ask;
    expect(ask).toContain("in transit");
  });

  it("scores completeness over required fields only", () => {
    expect(built.completenessBp).toBeGreaterThan(0);
    expect(built.completenessBp).toBeLessThan(10_000);
  });
});

describe("what was sold changes the answer more than the reason does", () => {
  it("asks a physical order for a carrier", () => {
    const built = assembleEvidence("product_not_received", holdings());
    expect(built.fields.map((f) => f.field)).toContain("shipping_documentation");
  });

  it("asks a digital order for the download log instead", () => {
    /*
     * Same reason code, completely different case. Submitting a tracking number
     * for a download is submitting nothing.
     */
    const built = assembleEvidence(
      "product_not_received",
      holdings({
        soldKind: "digital",
        shippingAddress: null,
        accessLog: [
          "2026-05-02T10:20:11Z — 203.0.113.42 — presets.zip",
          "2026-05-04T18:02:44Z — 203.0.113.42 — presets.zip",
        ],
      }),
    );
    expect(built.payload.access_activity_log).toContain("presets.zip");
    expect(built.fields.map((f) => f.field)).not.toContain("shipping_documentation");
    expect(built.hasGaps).toBe(false);
  });

  it("asks a service for the appointment and its documentation", () => {
    const built = assembleEvidence(
      "product_not_received",
      holdings({
        soldKind: "service",
        serviceAt: new Date("2026-05-10T14:00:00Z"),
        shippingAddress: null,
      }),
    );
    expect(built.payload.service_date).toBe("2026-05-10T14:00:00.000Z");
    expect(built.blockedOnSeller).toContain("service_documentation");
  });

  it("never asks a digital order for a shipping field at all", () => {
    /*
     * The playbook branches on kind *before* the field list is built, so a
     * download is never offered a carrier to not-have. That is stronger than
     * marking the field not-applicable: a readiness panel with six greyed-out
     * shipping rows on every digital sale is a panel nobody reads.
     *
     * The `not_applicable` guards inside `resolve` are therefore currently
     * unreachable, and kept deliberately — `REASON_PLAYBOOKS` is a data table
     * that will be edited, and the guard is what stops a flat list added to it
     * from asking a download for a tracking number.
     */
    const built = assembleEvidence(
      "general",
      holdings({ soldKind: "digital", accessLog: ["2026-05-02 — fetched"] }),
    );
    const asked = built.fields.map((f) => f.field);
    for (const field of [
      "shipping_address",
      "shipping_carrier",
      "shipping_tracking_number",
      "shipping_date",
      "shipping_documentation",
    ]) {
      expect(asked).not.toContain(field);
    }
  });

  it("does not count a not-applicable field against completeness", () => {
    const built = assembleEvidence(
      "general",
      holdings({
        soldKind: "digital",
        shippingAddress: null,
        accessLog: ["2026-05-02 — fetched"],
      }),
    );
    const applicableRequired = built.fields.filter(
      (f) => f.required && f.status !== "not_applicable",
    );
    expect(built.totalRequired).toBe(applicableRequired.length);
  });
});

describe("a digital order with no access log", () => {
  it("reports the gap rather than hiding it", () => {
    /*
     * The strongest possible evidence *for the buyer*: they paid and never got
     * the goods. Surfaced as missing, because the right action here is usually
     * to refund rather than to contest — and a system that quietly submitted a
     * confident-looking rebuttal would be helping the seller lose slowly.
     */
    const built = assembleEvidence(
      "product_not_received",
      holdings({ soldKind: "digital", accessLog: [] }),
    );
    const log = built.fields.find((f) => f.field === "access_activity_log");
    expect(log?.status).toBe("missing");
    expect(built.hasGaps).toBe(true);
  });
});

describe("the buyer's IP address", () => {
  it("is sent when held", () => {
    const built = assembleEvidence("fraudulent", holdings());
    expect(built.payload.customer_purchase_ip).toBe("203.0.113.42");
  });

  it("is missing rather than asked for, because nobody can produce it later", () => {
    /*
     * Not `needs_seller`. The buyer's connection existed for one request months
     * ago, so asking the seller for it wastes their time and hides the real
     * finding — that the order predates the capture.
     */
    const built = assembleEvidence("fraudulent", holdings({ buyerIp: null }));
    const ip = built.fields.find((f) => f.field === "customer_purchase_ip");
    expect(ip?.status).toBe("missing");
    expect(ip?.ask).toBeUndefined();
    expect(built.blockedOnSeller).not.toContain("customer_purchase_ip");
  });

  it("treats the rate limiter's 'unknown' as nothing", () => {
    /*
     * `ipFromHeaders` returns the literal string "unknown" with no forwarding
     * header. Sending it to Visa as a purchase IP is worse than sending nothing:
     * it is a field that reads as filled in.
     */
    const built = assembleEvidence("fraudulent", holdings({ buyerIp: "unknown" }));
    expect(built.payload.customer_purchase_ip).toBeUndefined();
  });
});

describe("terms acceptance as evidence", () => {
  it("states that the timestamp is server-side, which is the point of it", () => {
    /*
     * Visa 13.3 and 13.6 turn on whether the policy was *disclosed*, not on what
     * it says. "The buyer ticked a box" is a claim; a server-stamped timestamp
     * is a record, and saying which one this is matters to an issuer.
     */
    const built = assembleEvidence("product_unacceptable", holdings());
    expect(built.payload.refund_policy_disclosure).toContain("server-side");
    expect(built.payload.refund_policy_disclosure).toContain("2026-05-02T10:14:58");
    expect(built.payload.refund_policy_disclosure).toContain("Returns within 14 days");
  });

  it("tells the seller to switch it on when the shop was not asking", () => {
    const built = assembleEvidence(
      "product_unacceptable",
      holdings({ termsAcceptedAt: null }),
    );
    const field = built.fields.find((f) => f.field === "refund_policy_disclosure");
    expect(field?.status).toBe("missing");
    expect(field?.ask).toContain("Turn on terms acceptance");
  });
});

describe("credit_not_processed", () => {
  it("leads with the refund when one was actually issued", () => {
    /*
     * The one reason where the fastest answer is usually the true one: if the
     * refund went out, say so and stop.
     */
    const built = assembleEvidence(
      "credit_not_processed",
      holdings({ refundedCents: 3_400, refundedAt: new Date("2026-06-01T00:00:00Z") }),
    );
    expect(built.payload.refund_refusal_explanation).toContain("34.00 GBP");
    expect(built.payload.refund_refusal_explanation).toContain("duplicates it");
  });

  it("asks the seller to explain a refusal, and tells them what not to say", () => {
    const built = assembleEvidence("credit_not_processed", holdings());
    const field = built.fields.find((f) => f.field === "refund_refusal_explanation");
    expect(field?.status).toBe("needs_seller");
    expect(field?.ask).toContain("disclosed policy is the argument");
  });
});

describe("duplicate", () => {
  it("answers a duplicate claim with the absence of a second charge", () => {
    /*
     * "We found no other charge" is the answer, not a gap. A blank
     * `duplicate_charge_explanation` on a 12.6 is a forfeit.
     */
    const built = assembleEvidence("duplicate", holdings());
    expect(built.payload.duplicate_charge_explanation).toContain("no duplicate");
  });

  it("recommends refunding a real duplicate rather than contesting it", () => {
    const built = assembleEvidence(
      "duplicate",
      holdings({ duplicateChargeId: "ch_abc", duplicateIsDistinct: false }),
    );
    expect(built.payload.duplicate_charge_explanation).toContain("should be refunded");
  });

  it("distinguishes two genuinely separate orders", () => {
    const built = assembleEvidence(
      "duplicate",
      holdings({ duplicateChargeId: "ch_abc", duplicateIsDistinct: true }),
    );
    expect(built.payload.duplicate_charge_id).toBe("ch_abc");
    expect(built.payload.duplicate_charge_explanation).toContain("separate order");
  });
});

describe("subscription_canceled", () => {
  it("argues from continued use when the member kept using it", () => {
    const built = assembleEvidence(
      "subscription_canceled",
      holdings({
        soldKind: "service",
        cancelledAt: new Date("2026-06-20T00:00:00Z"),
        accessLog: ["2026-06-25T09:00:00Z — signed in", "2026-06-28T09:00:00Z — signed in"],
      }),
    );
    expect(built.payload.cancellation_rebuttal).toContain("2026-06-20");
    expect(built.payload.cancellation_rebuttal).toContain("2 time(s) after the charge");
  });

  it("states the absence of a cancellation as a fact about Stripe, not an opinion", () => {
    /*
     * Sailo cancels through Stripe's own hosted portal, so a cancellation would
     * be on the subscription object. "None does" is checkable; "the buyer is
     * mistaken" is not.
     */
    const built = assembleEvidence("subscription_canceled", holdings({ cancelledAt: null }));
    expect(built.payload.cancellation_rebuttal).toContain("hosted billing portal");
  });
});

describe("the bank rails", () => {
  it("does not hand a card playbook to a returned direct debit", () => {
    /*
     * A SEPA return arrives through the same webhook and the same Dispute
     * object, and none of the card evidence applies: there is no issuer to
     * persuade, because the payer's own bank returned the debit. Telling a
     * seller to gather proof of delivery is sending them to do work that cannot
     * change the outcome.
     */
    const playbook = playbookFor("insufficient_funds");
    expect(playbook.rail).toBe("bank_debit");
    expect(playbook.guidance).toContain("take payment another way");

    const built = assembleEvidence("insufficient_funds", holdings());
    expect(built.fields.map((f) => f.field)).not.toContain("shipping_documentation");
  });
});

describe("an unrecognised reason", () => {
  it("still produces a submission", () => {
    /*
     * Stripe's own type for `reason` is `string`, which is the API telling us it
     * adds codes. A submission with gaps beats no submission: an empty response
     * is an automatic loss.
     */
    const built = assembleEvidence("some_new_2027_reason", holdings());
    expect(Object.keys(built.payload).length).toBeGreaterThan(0);
    expect(built.payload.uncategorized_text).toContain("INV-0007");
  });
});

describe("the narrative", () => {
  const built = assembleEvidence("general", holdings());

  it("states facts and no argument", () => {
    const text = built.payload.uncategorized_text!;
    expect(text).toContain("INV-0007");
    expect(text).toContain("34.00 GBP");
    expect(text).toContain("203.0.113.42");
    expect(text).toContain("RM123456789GB");
    expect(text).toContain("accepted the shop's terms");
  });

  it("caps the access log rather than pasting four hundred rows", () => {
    const long = Array.from({ length: 400 }, (_, i) => `2026-05-02 — fetch ${i}`);
    const big = assembleEvidence(
      "general",
      holdings({ soldKind: "digital", accessLog: long }),
    );
    const text = big.payload.uncategorized_text!;
    expect(text).toContain("400 time(s)");
    expect(text).not.toContain("fetch 399");
  });
});

describe("Stripe's limits", () => {
  it("clamps one long field rather than letting it eat the budget", () => {
    const built = assembleEvidence(
      "general",
      holdings({ productDescription: "x".repeat(10_000) }),
    );
    expect(built.payload.product_description!.length).toBeLessThanOrEqual(
      EVIDENCE_FIELD_MAX,
    );
  });

  it("keeps the whole submission inside the 20,000-character ceiling", () => {
    /*
     * Over it, the *entire* update is rejected — losing the fields that were
     * right along with the one that overflowed. Enforced here rather than
     * discovered at the API.
     */
    const built = assembleEvidence(
      "general",
      holdings({
        productDescription: "x".repeat(9_000),
        refundPolicyText: "y".repeat(9_000),
        cancellationPolicyText: "z".repeat(9_000),
        soldKind: "digital",
        accessLog: Array.from({ length: 50 }, (_, i) => `line ${i} ${"q".repeat(200)}`),
      }),
    );
    const total = Object.values(built.payload).reduce((n, v) => n + v.length, 0);
    expect(total).toBeLessThanOrEqual(EVIDENCE_TEXT_BUDGET);
  });

  it("spends the budget on required fields first", () => {
    /*
     * Required fields come first in the playbook, so a submission that has to be
     * trimmed loses its persuasive extras and keeps what the network reads.
     * Silently dropping the reverse is how a complete-looking submission arrives
     * without its proof of delivery.
     */
    const built = assembleEvidence(
      "product_not_received",
      holdings({ shippingTrackingNumber: "RM1", productDescription: "p".repeat(9_000) }),
    );
    expect(built.payload.shipping_tracking_number).toBe("RM1");
  });

  it("never puts a file id in a text field", () => {
    const built = assembleEvidence(
      "product_not_received",
      holdings({ files: { shipping_documentation: "file_1abc" } }),
    );
    expect(built.fileIds.shipping_documentation).toBe("file_1abc");
    for (const key of Object.keys(built.payload)) {
      expect(EVIDENCE_FILE_FIELDS).not.toContain(key);
      expect(EVIDENCE_TEXT_FIELDS).toContain(key);
    }
  });

  it("closes the gap once the seller uploads the document", () => {
    const built = assembleEvidence(
      "product_not_received",
      holdings({ files: { shipping_documentation: "file_1abc" } }),
    );
    expect(built.hasGaps).toBe(false);
    expect(built.completenessBp).toBe(10_000);
    expect(built.blockedOnSeller).toHaveLength(0);
  });

  it("keeps persuasive uploads out of the blocking list", () => {
    /*
     * The bug this split fixed: a seller who had uploaded the proof of delivery
     * that decides their case was still shown two outstanding items — a customer
     * conversation and a receipt that neither the network asks for nor changes
     * the outcome. A complete case that reads as incomplete teaches the seller
     * to ignore the panel, which costs the next case.
     */
    const built = assembleEvidence(
      "product_not_received",
      holdings({ files: { shipping_documentation: "file_1abc" } }),
    );
    expect(built.optionalUploads).toContain("customer_communication");
    expect(built.optionalUploads).toContain("receipt");
    expect(built.blockedOnSeller).toHaveLength(0);
  });
});
