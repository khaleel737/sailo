import { describe, expect, it } from "vitest";
import {
  DISPUTE_OUTCOME_TONES,
  DISPUTE_STATUSES,
  acceptsStatusChange,
  daysToRespond,
  disputeOutcome,
  fundsWithdrawn,
  isClosed,
  isDisputeStatus,
  isInquiry,
  isUrgent,
  needsResponse,
} from "./lifecycle";

/**
 * The inquiry / chargeback split, pinned as money.
 *
 * Every assertion in the first two blocks was verified against Stripe's own API
 * in test mode on 17 August 2026 rather than read off the docs:
 *
 *   pm_card_createDispute        → status needs_response, case_type chargeback,
 *                                  network_reason_code 10.4, one balance
 *                                  transaction of net −5700 on a $42 charge
 *                                  ($42 + $15 dispute fee), is_charge_refundable
 *                                  false.
 *   pm_card_createDisputeInquiry → status warning_needs_response, case_type
 *                                  inquiry, network_reason_code 10,
 *                                  balance_transactions [], is_charge_refundable
 *                                  true.
 *
 * The second row is the one the first version of the webhook handler treated as
 * the first, which is how an order the seller had been paid for and still held
 * came to be marked refunded with its stock put back on the shelf.
 */

describe("isInquiry", () => {
  it("reads every warning_ status as an inquiry", () => {
    expect(isInquiry("warning_needs_response")).toBe(true);
    expect(isInquiry("warning_under_review")).toBe(true);
    expect(isInquiry("warning_closed")).toBe(true);
  });

  it("reads a chargeback as a chargeback", () => {
    expect(isInquiry("needs_response")).toBe(false);
    expect(isInquiry("under_review")).toBe(false);
    expect(isInquiry("won")).toBe(false);
    expect(isInquiry("lost")).toBe(false);
  });

  it("does not treat a prevented dispute as an inquiry", () => {
    // Deflected before it became a chargeback: no debit, but not a retrieval
    // request either, and it must not be counted as one.
    expect(isInquiry("prevented")).toBe(false);
  });
});

describe("fundsWithdrawn", () => {
  it("is true from the moment a chargeback arrives, before anyone decides", () => {
    // Stripe debits on arrival. The $42 charge was −$57 the same second.
    expect(fundsWithdrawn("needs_response")).toBe(true);
    expect(fundsWithdrawn("under_review")).toBe(true);
    expect(fundsWithdrawn("lost")).toBe(true);
  });

  it("is false for every inquiry, because nothing has moved", () => {
    expect(fundsWithdrawn("warning_needs_response")).toBe(false);
    expect(fundsWithdrawn("warning_under_review")).toBe(false);
    expect(fundsWithdrawn("warning_closed")).toBe(false);
  });

  it("is false once won, because winning reinstates the funds", () => {
    expect(fundsWithdrawn("won")).toBe(false);
  });

  it("is false for a prevented dispute, which never debited", () => {
    expect(fundsWithdrawn("prevented")).toBe(false);
  });
});

describe("disputeOutcome", () => {
  it("separates a closed inquiry from a won chargeback", () => {
    /*
     * The distinction the `status !== "won"` bug erased. Nothing was won on a
     * `warning_closed`, because nothing was taken — and calling it `won` would
     * put it in a win rate whose denominator never included it.
     */
    expect(disputeOutcome("warning_closed")).toBe("closed_no_loss");
    expect(disputeOutcome("won")).toBe("won");
  });

  it("never reports a closed inquiry as a loss", () => {
    // The exact shape of the bug: `warning_closed` took the lost branch,
    // marked the order refunded and restored its stock.
    expect(disputeOutcome("warning_closed")).not.toBe("lost");
  });

  it("groups both needs-response statuses under one call to action", () => {
    expect(disputeOutcome("needs_response")).toBe("needs_evidence");
    expect(disputeOutcome("warning_needs_response")).toBe("needs_evidence");
  });

  it("groups both under-review statuses", () => {
    expect(disputeOutcome("under_review")).toBe("under_review");
    expect(disputeOutcome("warning_under_review")).toBe("under_review");
  });

  it("treats a deflected dispute as no loss", () => {
    expect(disputeOutcome("prevented")).toBe("closed_no_loss");
  });

  it("has a tone for every outcome it can produce", () => {
    for (const status of DISPUTE_STATUSES) {
      expect(DISPUTE_OUTCOME_TONES[disputeOutcome(status)]).toBeTruthy();
    }
  });

  it("colours a closed inquiry the same as a win, because the seller kept the money", () => {
    expect(DISPUTE_OUTCOME_TONES.closed_no_loss).toBe(
      DISPUTE_OUTCOME_TONES.won,
    );
  });
});

describe("isDisputeStatus", () => {
  it("carries prevented, which Stripe's docs page omits and its SDK does not", () => {
    expect(isDisputeStatus("prevented")).toBe(true);
  });

  it("rejects a status nobody has met", () => {
    expect(isDisputeStatus("pending_review")).toBe(false);
  });
});

describe("needsResponse / isClosed", () => {
  it("agrees with itself on every status", () => {
    for (const status of DISPUTE_STATUSES) {
      // A dispute cannot both owe a response and be finished.
      expect(needsResponse(status) && isClosed(status)).toBe(false);
    }
  });
});

describe("acceptsStatusChange", () => {
  const at = (iso: string) => new Date(iso);

  it("refuses to reopen a decided dispute", () => {
    /*
     * The out-of-order retry. Stripe delivers at least once and in no
     * guaranteed order, so an `updated` carrying `needs_response` can land
     * after the `closed` carrying `won`. Applying it would put the deadline
     * back on the seller's dashboard and tell them reinstated money was gone.
     */
    expect(
      acceptsStatusChange(
        { status: "won", stripeUpdatedAt: at("2026-08-10T00:00:00Z") },
        { status: "needs_response", occurredAt: at("2026-08-01T00:00:00Z") },
      ),
    ).toBe(false);
  });

  it("lets a won dispute be corrected to lost", () => {
    // Rare, and it does happen: an arbitration reverses an outcome. A closed
    // dispute accepts another closed status.
    expect(
      acceptsStatusChange(
        { status: "won", stripeUpdatedAt: at("2026-08-10T00:00:00Z") },
        { status: "lost", occurredAt: at("2026-08-12T00:00:00Z") },
      ),
    ).toBe(true);
  });

  it("drops a stale open-to-open update", () => {
    expect(
      acceptsStatusChange(
        { status: "under_review", stripeUpdatedAt: at("2026-08-10T00:00:00Z") },
        { status: "needs_response", occurredAt: at("2026-08-09T00:00:00Z") },
      ),
    ).toBe(false);
  });

  it("accepts an event sharing a second with the one before it", () => {
    /*
     * `charge.dispute.created` and the `funds_withdrawn` that accompanies it
     * arrive on the same second. A strict `>` drops the second one and leaves
     * the deduction unrecorded, which is the number HQ needs most.
     */
    expect(
      acceptsStatusChange(
        { status: "needs_response", stripeUpdatedAt: at("2026-08-10T00:00:00Z") },
        { status: "under_review", occurredAt: at("2026-08-10T00:00:00Z") },
      ),
    ).toBe(true);
  });

  it("is a no-op when nothing changed", () => {
    expect(
      acceptsStatusChange(
        { status: "needs_response", stripeUpdatedAt: at("2026-08-10T00:00:00Z") },
        { status: "needs_response", occurredAt: at("2026-08-11T00:00:00Z") },
      ),
    ).toBe(false);
  });

  it("accepts anything when nothing has been recorded yet", () => {
    expect(
      acceptsStatusChange(
        { status: "needs_response", stripeUpdatedAt: null },
        { status: "under_review", occurredAt: at("2026-08-11T00:00:00Z") },
      ),
    ).toBe(true);
  });
});

describe("daysToRespond", () => {
  const now = new Date("2026-08-17T12:00:00Z");

  it("rounds down, because due_by is a cut-off and not a target", () => {
    // 1 day and 23 hours left. Telling a seller "2 days" when they have one
    // is the kind of help that loses the case.
    const dueBy = new Date("2026-08-19T11:00:00Z");
    expect(daysToRespond({ status: "needs_response", dueBy }, now)).toBe(1);
  });

  it("returns 0 rather than a negative number once the deadline has passed", () => {
    const dueBy = new Date("2026-08-10T00:00:00Z");
    expect(daysToRespond({ status: "needs_response", dueBy }, now)).toBe(0);
  });

  it("is null when nothing is owed", () => {
    const dueBy = new Date("2026-09-01T00:00:00Z");
    expect(daysToRespond({ status: "under_review", dueBy }, now)).toBeNull();
    expect(daysToRespond({ status: "won", dueBy }, now)).toBeNull();
  });

  it("is null when Stripe gave no deadline", () => {
    expect(daysToRespond({ status: "needs_response", dueBy: null }, now)).toBeNull();
  });
});

describe("isUrgent", () => {
  const now = new Date("2026-08-17T12:00:00Z");

  it("is true inside the last week, when evidence still needs gathering", () => {
    expect(
      isUrgent({ status: "needs_response", dueBy: new Date("2026-08-22T12:00:00Z") }, now),
    ).toBe(true);
  });

  it("is false with three weeks to go", () => {
    expect(
      isUrgent({ status: "needs_response", dueBy: new Date("2026-09-07T12:00:00Z") }, now),
    ).toBe(false);
  });

  it("is false once the dispute is decided", () => {
    expect(
      isUrgent({ status: "lost", dueBy: new Date("2026-08-18T12:00:00Z") }, now),
    ).toBe(false);
  });
});
