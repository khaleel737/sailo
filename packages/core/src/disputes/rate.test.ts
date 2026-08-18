import { describe, expect, it } from "vitest";
import {
  EMPTY_TALLY,
  NETWORK_PROGRAMMES,
  RATE_FLOORS,
  SAILO_THRESHOLDS,
  cohortMaturity,
  emergingRisk,
  formatBp,
  meetsFloor,
  pooledRate,
  rateCohort,
  ratioBp,
  winRateBp,
  type Cohort,
  type DisputeTally,
} from "./rate";

/**
 * The three ways a dispute rate goes wrong, each pinned as a test.
 *
 * 1. Measuring this month's disputes against this month's orders. Disputes
 *    arrive 60–120 days after the sale, so on a growing shop the numerator
 *    belongs to a much smaller denominator than the one it is divided by — and
 *    the faster the shop grows, the cleaner its fraud looks. `growing shop`
 *    below is the case, with the numbers worked out.
 * 2. Dividing by a denominator too small to divide by. One dispute on three
 *    orders is 33%, and a threshold cannot tell it from a real 33%.
 * 3. Averaging per-period percentages instead of pooling the counts, which
 *    weights a four-order month the same as a four-hundred-order month.
 */

const tally = (over: Partial<DisputeTally> = {}): DisputeTally => ({
  ...EMPTY_TALLY,
  ...over,
});

const NOW = new Date("2026-08-17T00:00:00Z");
const month = (m: number, settledOrders: number, over: Partial<DisputeTally> = {}): Cohort => ({
  start: new Date(Date.UTC(2026, m - 1, 1)),
  end: new Date(Date.UTC(2026, m, 1)),
  settledOrders,
  tally: tally(over),
});

describe("ratioBp", () => {
  it("returns basis points", () => {
    expect(ratioBp(3, 200)).toBe(150);
  });

  it("refuses to divide by nothing rather than returning zero", () => {
    /*
     * Null, not 0. A zero would be sorted, charted, compared against a
     * threshold and eventually acted on by code written a year from now by
     * someone who did not read the comment. Null cannot be.
     */
    expect(ratioBp(0, 0)).toBeNull();
    expect(ratioBp(4, 0)).toBeNull();
  });

  it("rounds to the nearest basis point", () => {
    expect(ratioBp(1, 3)).toBe(3333);
  });
});

describe("cohortMaturity", () => {
  it("calls a cohort mature once the 120-day dispute window has closed", () => {
    // Orders from March, measured in August: every dispute that is coming has
    // come.
    expect(cohortMaturity(new Date("2026-04-01T00:00:00Z"), NOW)).toBe("mature");
  });

  it("calls last month immature, because its disputes have not arrived", () => {
    expect(cohortMaturity(new Date("2026-08-01T00:00:00Z"), NOW)).toBe("immature");
  });

  it("has a middle state, because a partial count is still worth showing", () => {
    // Sixty days on: most of what is coming has come. Worth a caveat rather
    // than being withheld.
    expect(cohortMaturity(new Date("2026-06-10T00:00:00Z"), NOW)).toBe("maturing");
  });
});

describe("the growing shop", () => {
  /*
   * The trap, with the arithmetic that makes it dangerous.
   *
   * A seller running genuine 6% fraud, tripling volume each month:
   *
   *   May     100 orders,  6 chargebacks
   *   June    300 orders, 18 chargebacks
   *   July    900 orders, 54 chargebacks
   *
   * Every May dispute arrives in August. The naive query — "disputes created
   * this month over orders created this month" — divides May's 6 by August's
   * 2,700 and reports 22bp. Clean. The seller is at 600bp.
   */
  const may = month(5, 100, { chargebacks: 6, fraudChargebacks: 6 });

  it("measures a cohort against the orders the disputes came from", () => {
    const rated = rateCohort(may, NOW);
    expect(rated.chargebackBp).toBe(600);
  });

  it("is only 'maturing' in August, which is the honest reading", () => {
    /*
     * Worth pinning, because it surprised the author of this test.
     *
     * May's cohort closes on 1 June, and 1 June to 17 August is 77 days — short
     * of the 120-day dispute window. So on 17 August the newest *mature* cohort
     * is March's. A pooled rate built from mature cohorts alone is therefore
     * always looking at data four months old, which is why `maturing` counts
     * towards it and why `emergingRisk` exists at all.
     */
    expect(rateCohort(may, NOW).maturity).toBe("maturing");
  });

  it("counts a maturing cohort towards the pooled rate", () => {
    // If it did not, the rate that decisions are taken on would never include
    // anything from the last four months.
    const pooled = pooledRate([rateCohort(may, NOW)]);
    expect(pooled.settledOrders).toBe(100);
    expect(pooled.chargebackBp).toBe(600);
  });

  it("reports 600bp, not the 22bp an arrival-month query would produce", () => {
    // The naive figure, spelled out so the difference is in the diff.
    const naive = ratioBp(6, 2_700);
    expect(naive).toBe(22);
    expect(rateCohort(may, NOW).chargebackBp).toBe(600);
  });

  it("is well over the payout-hold threshold, so the shop is caught", () => {
    expect(rateCohort(may, NOW).chargebackBp!).toBeGreaterThan(
      SAILO_THRESHOLDS.payoutHoldBp,
    );
  });
});

describe("the floor", () => {
  it("withholds a rate for one dispute on three orders", () => {
    const rated = rateCohort(month(3, 3, { chargebacks: 1 }), NOW);
    expect(rated.chargebackBp).toBeNull();
  });

  it("still shows the unfloored figure for display, kept apart from the one that acts", () => {
    /*
     * A table has to be able to say "1 of 3" honestly. `displayBp` is that
     * number and nothing may compare it to a threshold — which is why it is a
     * separate field rather than the same one with a flag beside it.
     */
    const rated = rateCohort(month(3, 3, { chargebacks: 1 }), NOW);
    expect(rated.displayBp).toBe(3333);
    expect(rated.chargebackBp).toBeNull();
  });

  it("needs a pattern and not just volume: one dispute on a thousand orders is still null", () => {
    // The numerator floor is the one that does the work. A denominator floor
    // alone still lets a single chargeback trip a threshold.
    const rated = rateCohort(month(3, 1_000, { chargebacks: 1 }), NOW);
    expect(rated.chargebackBp).toBeNull();
  });

  it("produces a rate once both sides clear", () => {
    const rated = rateCohort(month(3, 100, { chargebacks: 2 }), NOW);
    expect(rated.chargebackBp).toBe(200);
  });

  it("holds the payout floor higher than the review floor", () => {
    // Taking money is a bigger step than asking a human to look, so it needs
    // more evidence.
    expect(RATE_FLOORS.payoutHold.minChargebacks).toBeGreaterThan(
      RATE_FLOORS.review.minChargebacks,
    );
    expect(RATE_FLOORS.payoutHold.minSettledOrders).toBeGreaterThan(
      RATE_FLOORS.review.minSettledOrders,
    );
  });

  it("meetsFloor requires both sides", () => {
    const floor = RATE_FLOORS.review;
    expect(meetsFloor(tally({ chargebacks: 2 }), 25, floor)).toBe(true);
    expect(meetsFloor(tally({ chargebacks: 1 }), 500, floor)).toBe(false);
    expect(meetsFloor(tally({ chargebacks: 9 }), 24, floor)).toBe(false);
  });
});

describe("inquiries", () => {
  it("never reach a ratio", () => {
    /*
     * Neither Visa's VAMP nor Mastercard's MMP counts a retrieval request, so
     * a rate that does is not the rate we are measured on. Counting them
     * roughly doubles the apparent figure.
     */
    const rated = rateCohort(month(3, 100, { inquiries: 40 }), NOW);
    expect(rated.chargebackBp).toBeNull();
    expect(rated.displayBp).toBe(0);
  });

  it("are still carried, so a seller sees them", () => {
    const rated = rateCohort(month(3, 100, { inquiries: 40 }), NOW);
    expect(rated.tally.inquiries).toBe(40);
  });
});

describe("pooledRate", () => {
  it("pools counts rather than averaging percentages", () => {
    /*
     * March: 4 orders, 2 chargebacks — 5000bp.
     * April: 396 orders, 2 chargebacks — 51bp.
     *
     * Averaging the two gives 2525bp and convicts a shop that has since sold
     * four hundred orders with two disputes. Pooling gives 100bp, which is
     * what actually came back out of what was actually sold.
     */
    const cohorts = [
      rateCohort(month(3, 4, { chargebacks: 2 }), NOW),
      rateCohort(month(4, 396, { chargebacks: 2 }), NOW),
    ];
    const pooled = pooledRate(cohorts);
    expect(pooled.settledOrders).toBe(400);
    expect(pooled.tally.chargebacks).toBe(4);
    expect(pooled.chargebackBp).toBe(100);
  });

  it("excludes immature cohorts from both sides", () => {
    /*
     * A shop cannot dilute a bad history by launching a big month. August's
     * 5,000 orders have not had time to be disputed, so counting them in the
     * denominator would drop a 600bp shop to 11bp on volume alone.
     */
    const cohorts = [
      rateCohort(month(5, 100, { chargebacks: 6 }), NOW),
      rateCohort(month(8, 5_000, { chargebacks: 0 }), NOW),
    ];
    const pooled = pooledRate(cohorts);
    expect(pooled.settledOrders).toBe(100);
    expect(pooled.chargebackBp).toBe(600);
  });

  it("returns null below the floor rather than a small comforting number", () => {
    const pooled = pooledRate([rateCohort(month(3, 900, { chargebacks: 1 }), NOW)]);
    expect(pooled.chargebackBp).toBeNull();
    expect(pooled.tally.chargebacks).toBe(1);
  });
});

describe("emergingRisk", () => {
  it("counts chargebacks on cohorts too young to have a rate", () => {
    /*
     * The counterpart to excluding immature cohorts, and the reason that
     * exclusion is safe. A three-week-old shop with four chargebacks has no
     * measurable rate and needs looking at immediately.
     */
    const cohorts = [
      rateCohort(month(8, 40, { chargebacks: 4 }), NOW),
      rateCohort(month(3, 500, { chargebacks: 1 }), NOW),
    ];
    expect(emergingRisk(cohorts)).toBe(4);
  });

  it("ignores mature cohorts, which the pooled rate already covers", () => {
    expect(emergingRisk([rateCohort(month(3, 500, { chargebacks: 9 }), NOW)])).toBe(0);
  });
});

describe("winRateBp", () => {
  it("divides by decided disputes, not by all of them", () => {
    // Six open cases during a busy month must not read as six losses.
    expect(winRateBp(tally({ chargebacks: 10, won: 3, lost: 1 }))).toBe(7500);
  });

  it("is null before anything has been decided", () => {
    expect(winRateBp(tally({ chargebacks: 6 }))).toBeNull();
  });
});

describe("network thresholds", () => {
  it("asks a human to look before the tightest network threshold, not after", () => {
    /*
     * The bug this test was written to catch, and it caught it on the first
     * run: `reviewBp` was 100 against Visa's 90, so Sailo's first alarm fired
     * once the shop had already taken the platform over Visa's merchant
     * threshold. A control that reports a breach is not a control.
     *
     * The network counts are platform-wide and in the thousands, so Visa's
     * 1,000-chargeback floor is not what saves us — Stripe reserves against
     * Sailo's own account long before then (`payments-compliance.md` §3.2).
     */
    const tightest = Math.min(...NETWORK_PROGRAMMES.map((p) => p.thresholdBp));
    expect(SAILO_THRESHOLDS.reviewBp).toBeLessThan(tightest);
  });

  it("orders its own ladder", () => {
    expect(SAILO_THRESHOLDS.watchBp).toBeLessThan(SAILO_THRESHOLDS.reviewBp);
    expect(SAILO_THRESHOLDS.reviewBp).toBeLessThan(SAILO_THRESHOLDS.payoutHoldBp);
  });

  it("records that Mastercard divides by the previous month", () => {
    /*
     * Not a detail. A shop that halves its volume sees its Mastercard ratio
     * double with no change in behaviour, and a monitoring dashboard that does
     * not know this reports a crisis that is arithmetic.
     */
    const mmp = NETWORK_PROGRAMMES.filter((p) => p.network === "mastercard");
    expect(mmp.length).toBeGreaterThan(0);
    for (const p of mmp) expect(p.denominator).toBe("previous_month");
  });

  it("marks the published figures as needing confirmation", () => {
    // They moved on 1 January 2026 and will move again. Anything relied on
    // here has to be confirmed with the acquirer, and saying so in the data is
    // more honest than a comment nobody reads.
    for (const p of NETWORK_PROGRAMMES) {
      expect(p.needsConfirmation).toBe(true);
      expect(p.source).toMatch(/\d{4}/);
    }
  });
});

describe("formatBp", () => {
  it("renders a withheld rate as a dash rather than 0.00%", () => {
    expect(formatBp(null)).toBe("—");
    expect(formatBp(0)).toBe("0.00%");
    expect(formatBp(150)).toBe("1.50%");
  });
});
