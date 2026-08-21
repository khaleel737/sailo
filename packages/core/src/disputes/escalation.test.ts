import { describe, expect, it } from "vitest";
import {
  CLEARANCE_GRACE_CHARGEBACKS,
  ESCALATION_LEVELS,
  EXPOSURE_HOLD_CENTS,
  MAX_AUTOMATIC_LEVEL,
  assessShop,
  isAutomatic,
  isHigherLevel,
  suspensionWarranted,
  unrecoverableCents,
  type ShopRisk,
} from "./escalation";
import { EMPTY_TALLY, type DisputeTally } from "./rate";

/**
 * The ladder, and the reason it is ordered the way it is.
 *
 * Closing a storefront is the instinct and the wrong first move. It does not
 * protect the money — the exposure is the balance about to be paid out, not the
 * sales that have not happened — and it is not reversible in the way that
 * matters: a seller whose shop went dark has told their customers something
 * about Sailo that clearing a flag does not untell.
 *
 * So: hold the payout, ask a human, and never close a shop from arithmetic.
 */

const risk = (over: Partial<ShopRisk> = {}): ShopRisk => ({
  chargebackBp: null,
  settledOrders: 0,
  tally: { ...EMPTY_TALLY },
  emergingChargebacks: 0,
  exposure: { openDisputeCents: 0, balanceCents: 0, negativeBalanceCents: 0 },
  clearedAt: null,
  chargebacksSinceClearance: 0,
  ...over,
});

const tally = (over: Partial<DisputeTally>): DisputeTally => ({
  ...EMPTY_TALLY,
  ...over,
});

describe("what may happen automatically", () => {
  it("stops at a payout hold", () => {
    expect(MAX_AUTOMATIC_LEVEL).toBe("payout_hold");
    expect(isAutomatic("payout_hold")).toBe(true);
    expect(isAutomatic("suspend")).toBe(false);
  });

  it("never returns suspend from any combination of facts", () => {
    /*
     * The guarantee, exhaustively. Suspension is a judgement about whether this
     * is a fraud ring or a shop that had a terrible month, and the cost of
     * getting it wrong falls entirely on a real business.
     */
    const extremes: ShopRisk[] = [
      risk({ chargebackBp: 9_000, settledOrders: 10_000, tally: tally({ chargebacks: 900 }) }),
      risk({ emergingChargebacks: 500 }),
      risk({
        exposure: { openDisputeCents: 10_000_000, balanceCents: 0, negativeBalanceCents: 500_000 },
      }),
      risk({
        chargebackBp: 10_000,
        settledOrders: 100,
        tally: tally({ chargebacks: 100 }),
        emergingChargebacks: 99,
        exposure: { openDisputeCents: 999_999, balanceCents: 0, negativeBalanceCents: 999_999 },
      }),
    ];
    for (const r of extremes) {
      const decision = assessShop(r);
      expect(decision.level).not.toBe("suspend");
      expect(decision.automatic).toBe(true);
    }
  });

  it("orders the ladder by what it costs to be wrong", () => {
    expect(ESCALATION_LEVELS).toEqual([
      "clear",
      "watch",
      "review",
      "payout_hold",
      "suspend",
    ]);
    expect(isHigherLevel("payout_hold", "review")).toBe(true);
    expect(isHigherLevel("watch", "review")).toBe(false);
  });
});

describe("exposure", () => {
  it("is what the open disputes exceed the balance by", () => {
    // $600 of open disputes against a $200 balance: Sailo covers $400.
    expect(
      unrecoverableCents({
        openDisputeCents: 60_000,
        balanceCents: 20_000,
        negativeBalanceCents: 0,
      }),
    ).toBe(40_000);
  });

  it("is nothing when the balance covers the disputes", () => {
    expect(
      unrecoverableCents({
        openDisputeCents: 20_000,
        balanceCents: 60_000,
        negativeBalanceCents: 0,
      }),
    ).toBe(0);
  });

  it("counts a balance that has already gone under", () => {
    /*
     * A negative balance is not a risk, it is a realised loss sitting on
     * Stripe's books against Sailo's reserve — 180 days from being taken.
     */
    expect(
      unrecoverableCents({
        openDisputeCents: 0,
        balanceCents: 0,
        negativeBalanceCents: 30_000,
      }),
    ).toBe(30_000);
  });

  it("does not count a debited dispute twice", () => {
    /*
     * The bug a live run found, and the reason this is a `max` and not a sum.
     *
     * A real $600 chargeback on a connected account with nothing else in it
     * reported: open disputes $615, available $0, negative $615 — and an exposure
     * of $1,230. Stripe debits the balance when the chargeback lands, so the
     * negative balance *is* the open dispute. Summing them holds payouts at half
     * the shortfall the threshold was set for.
     */
    expect(
      unrecoverableCents({
        openDisputeCents: 61_500,
        balanceCents: 0,
        negativeBalanceCents: 61_500,
      }),
    ).toBe(61_500);
  });

  it("takes the worse view when the two disagree", () => {
    // An account $200 under for some other reason, with $500 of open disputes
    // against a $100 balance: the forward view ($400) is the worse one.
    expect(
      unrecoverableCents({
        openDisputeCents: 50_000,
        balanceCents: 10_000,
        negativeBalanceCents: 20_000,
      }),
    ).toBe(40_000);

    // And the other way round.
    expect(
      unrecoverableCents({
        openDisputeCents: 5_000,
        balanceCents: 4_000,
        negativeBalanceCents: 20_000,
      }),
    ).toBe(20_000);
  });

  it("holds payouts on exposure alone, with no rate at all", () => {
    /*
     * The case a ratio cannot see: one large disputed order on a shop with no
     * history. There is no rate — the floor withholds it — and the money is
     * leaving on the next payout run.
     */
    const decision = assessShop(
      risk({
        exposure: { openDisputeCents: 40_000, balanceCents: 5_000, negativeBalanceCents: 0 },
      }),
    );
    expect(decision.level).toBe("payout_hold");
    expect(decision.unrecoverableCents).toBe(35_000);
    expect(decision.reason).toContain("Sailo would cover");
  });

  it("does not hold payouts for a shortfall smaller than a false positive costs", () => {
    // A held payout is a seller who cannot pay their own supplier. One $15
    // dispute fee must never reach for that.
    const decision = assessShop(
      risk({
        exposure: {
          openDisputeCents: EXPOSURE_HOLD_CENTS - 100,
          balanceCents: 0,
          negativeBalanceCents: 0,
        },
      }),
    );
    expect(decision.level).not.toBe("payout_hold");
  });

  it("outranks a staff clearance", () => {
    /*
     * A clearance is a judgement that a shop's *behaviour* is acceptable. It is
     * not a decision to fund that shop's shortfall out of Sailo's reserve, and
     * nobody clearing a rate in /hq intended to authorise that.
     */
    const decision = assessShop(
      risk({
        clearedAt: new Date("2026-08-01T00:00:00Z"),
        chargebacksSinceClearance: 0,
        tally: tally({ chargebacks: 5 }),
        exposure: { openDisputeCents: 90_000, balanceCents: 0, negativeBalanceCents: 0 },
      }),
    );
    expect(decision.level).toBe("payout_hold");
  });
});

describe("the floor, at the ladder", () => {
  it("leaves a hobbyist with one angry customer alone", () => {
    /*
     * One chargeback on eight orders is 1,250bp and means nothing. This is the
     * shop the whole floor exists to protect: suspending hobbyists while
     * missing professionals is the failure mode.
     */
    const decision = assessShop(
      risk({ chargebackBp: null, settledOrders: 8, tally: tally({ chargebacks: 1 }) }),
    );
    expect(decision.level).toBe("watch");
    expect(decision.reason).toContain("floor");
  });

  it("says nothing at all about a shop with no chargebacks", () => {
    expect(assessShop(risk({ settledOrders: 500 })).level).toBe("clear");
  });

  it("catches a professional at 3% on two thousand orders", () => {
    const decision = assessShop(
      risk({
        chargebackBp: 300,
        settledOrders: 2_000,
        tally: tally({ chargebacks: 60 }),
      }),
    );
    expect(decision.level).toBe("payout_hold");
    expect(decision.reason).toContain("the storefront stays open");
  });

  it("will not hold payouts on a rate that clears the review floor but not the payout one", () => {
    /*
     * 2 chargebacks on 30 orders is 667bp — over every threshold — and still
     * only worth a human's attention, because two disputes is a pattern and not
     * yet a business. Taking money needs more evidence than asking a question.
     */
    const decision = assessShop(
      risk({ chargebackBp: 667, settledOrders: 30, tally: tally({ chargebacks: 2 }) }),
    );
    expect(decision.level).toBe("review");
  });
});

describe("the growing fraudster", () => {
  it("is reviewed on count when its cohorts are too young for a rate", () => {
    /*
     * Three weeks old, four chargebacks, no measurable rate — because the
     * denominator has not finished happening. Three separate cardholders
     * disputing inside the window is not a rate and does not need to be one.
     */
    const decision = assessShop(risk({ emergingChargebacks: 4 }));
    expect(decision.level).toBe("review");
    expect(decision.reason).toContain("too recent");
  });

  it("ignores one or two, which is a bad week", () => {
    expect(assessShop(risk({ emergingChargebacks: 2 })).level).toBe("clear");
  });
});

describe("staff clearance", () => {
  const cleared = (sinceClearance: number) =>
    risk({
      clearedAt: new Date("2026-08-01T00:00:00Z"),
      chargebacksSinceClearance: sinceClearance,
      chargebackBp: 900,
      settledOrders: 400,
      tally: tally({ chargebacks: 4 + sinceClearance }),
    });

  it("holds against the same arithmetic that flagged the shop", () => {
    /*
     * Without this, a cleared shop is re-flagged by the next run of the same
     * sum — which is how an automated check teaches everybody to ignore it.
     * The count is of chargebacks *dated after* the clearance, never a delta
     * of pooled tallies — a cohort maturing in must not break a clearance
     * with zero new disputes.
     */
    expect(assessShop(cleared(0)).level).toBe("clear");
    expect(assessShop(cleared(1)).level).toBe("clear");
  });

  it("is overridden by new evidence rather than by time", () => {
    // Two new chargebacks since the clearance: the facts have changed.
    expect(assessShop(cleared(CLEARANCE_GRACE_CHARGEBACKS)).level).toBe(
      "payout_hold",
    );
  });
});

describe("suspensionWarranted", () => {
  it("is never true until the reversible move has been made", () => {
    const bad = risk({
      chargebackBp: 5_000,
      settledOrders: 1_000,
      tally: tally({ chargebacks: 500 }),
    });
    expect(suspensionWarranted(bad, false)).toBe(false);
    expect(suspensionWarranted(bad, true)).toBe(true);
  });

  it("wants a shop far over the line, not merely over it", () => {
    const over = risk({
      chargebackBp: 200,
      settledOrders: 1_000,
      tally: tally({ chargebacks: 20 }),
    });
    expect(suspensionWarranted(over, true)).toBe(false);
  });

  it("can be reached on count alone by a shop with no measurable rate", () => {
    expect(suspensionWarranted(risk({ emergingChargebacks: 6 }), true)).toBe(true);
    expect(suspensionWarranted(risk({ emergingChargebacks: 3 }), true)).toBe(false);
  });
});

describe("the reason string", () => {
  it("carries the figures that tripped it, so the next person can judge it", () => {
    /*
     * Stored in `shops.payoutsPausedReason`, where it outlives the numbers that
     * produced it. "High dispute rate" tells the next person nothing.
     */
    const decision = assessShop(
      risk({ chargebackBp: 300, settledOrders: 2_000, tally: tally({ chargebacks: 60 }) }),
    );
    expect(decision.reason).toContain("60 chargebacks");
    expect(decision.reason).toContain("2000 settled orders");
    expect(decision.reason).toContain("3.00%");
    expect(decision.reason).toContain("measured against the orders they came from");
  });
});
