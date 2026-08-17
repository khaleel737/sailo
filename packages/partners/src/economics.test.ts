import { describe, expect, it } from "vitest";
import { PAID_PLAN_IDS, PLANS } from "@sailo/core/plans";
import {
  DEFAULT_COMMISSION_BP,
  DEFAULT_HOLD_DAYS,
  DEFAULT_PAYOUT_MINIMUM_CENTS,
  commissionCents,
  isPayableBalance,
  shareLabel,
} from "./program";

/**
 * What the partner programme actually pays at the prices Sailo actually
 * charges.
 *
 * `program.test.ts` covers the arithmetic in isolation — floors, overrides,
 * reversals — with numbers of its own. This file is the other half, and it is
 * the half that broke: the rate and the plan prices are two constants in two
 * packages that nothing links, and they only mean something *together*. When
 * Pro went from $9.99 to $19 and Business from $19.99 to $49, every number a
 * partner is shown moved and not one test noticed, because each side was
 * individually correct.
 *
 * So these assert the *product* of the two. They are deliberately written as
 * concrete money rather than as re-derived formulas — a test that recomputes
 * `floor(price × bp / 10000)` and compares it to `floor(price × bp / 10000)`
 * passes whatever either constant becomes, which is precisely the failure it
 * was meant to catch. If a price or the rate changes on purpose, these numbers
 * change with it and the diff says what a partner's income just did.
 */

describe("what one referral pays, at list price", () => {
  it("pays $5.70 a month for a Pro referral", () => {
    expect(commissionCents(PLANS.pro.monthlyCents, DEFAULT_COMMISSION_BP)).toBe(570);
  });

  it("pays $14.70 a month for a Business referral", () => {
    expect(commissionCents(PLANS.business.monthlyCents, DEFAULT_COMMISSION_BP)).toBe(1470);
  });

  it("pays $54.00 and $140.40 on the yearly invoices", () => {
    expect(commissionCents(PLANS.pro.yearlyCents, DEFAULT_COMMISSION_BP)).toBe(5400);
    expect(commissionCents(PLANS.business.yearlyCents, DEFAULT_COMMISSION_BP)).toBe(14040);
  });

  it("states the rate as 30%", () => {
    expect(shareLabel(DEFAULT_COMMISSION_BP)).toBe("30%");
  });

  it("pays more for the plan that costs more", () => {
    // Guards the inversion, which is not hypothetical: the platform fee ladder
    // was upside down for months for the same reason — two numbers set in two
    // places by two people with the right intention each time.
    const cuts = PAID_PLAN_IDS.map((id) =>
      commissionCents(PLANS[id].monthlyCents, DEFAULT_COMMISSION_BP),
    );
    expect(cuts).toEqual([...cuts].sort((a, b) => a - b));
  });

  it("never pays out more than Sailo took in", () => {
    // The floor in `commissionCents` is what makes this true, and it is the one
    // property of the rate that cannot be allowed to change: a partner paid a
    // rounded-up share of every invoice is a slow leak nobody reconciles.
    for (const id of PAID_PLAN_IDS) {
      for (const amount of [PLANS[id].monthlyCents, PLANS[id].yearlyCents]) {
        const cut = commissionCents(amount, DEFAULT_COMMISSION_BP);
        expect(cut * 10_000).toBeLessThanOrEqual(amount * DEFAULT_COMMISSION_BP);
      }
    }
  });
});

/**
 * The number a partner actually experiences, which no constant states.
 *
 * A threshold and a rate are each reasonable on their own and can combine into
 * a programme that never pays anybody. At the old $9.99 Pro price a single
 * referral earned $3.00 a month against a $25 minimum — nine months to a first
 * payout, on top of the hold. The prices doubled and that is now five, which is
 * the sort of improvement that should be visible in a diff rather than
 * discovered by a partner who gave up.
 */
function invoicesToFirstPayout(invoiceCents: number): number {
  const perInvoice = commissionCents(invoiceCents, DEFAULT_COMMISSION_BP);
  return Math.ceil(DEFAULT_PAYOUT_MINIMUM_CENTS / perInvoice);
}

describe("how long a partner waits to be paid", () => {
  it("takes five monthly invoices on Pro and two on Business", () => {
    expect(invoicesToFirstPayout(PLANS.pro.monthlyCents)).toBe(5);
    expect(invoicesToFirstPayout(PLANS.business.monthlyCents)).toBe(2);
  });

  it("clears the threshold on a single yearly invoice, either plan", () => {
    // A partner who refers an annual subscriber should not also be made to
    // wait: the money arrived in one payment and the threshold exists for
    // transfer fees, not as a retention device.
    for (const id of PAID_PLAN_IDS) {
      expect(invoicesToFirstPayout(PLANS[id].yearlyCents)).toBe(1);
      expect(
        isPayableBalance(
          commissionCents(PLANS[id].yearlyCents, DEFAULT_COMMISSION_BP),
          DEFAULT_PAYOUT_MINIMUM_CENTS,
        ),
      ).toBe(true);
    }
  });

  it("keeps the wait on the cheapest paid plan inside half a year", () => {
    /*
     * The line this programme should not cross, stated once rather than left
     * to judgement at the next price change. Five monthly invoices plus a
     * thirty-day hold is roughly six months to a first payout on Pro — already
     * long enough that a partner may stop believing in it, and the only reason
     * it is acceptable is that Business is two. A price cut that pushes this
     * past six should be a decision, not a consequence.
     */
    const months = invoicesToFirstPayout(PLANS.pro.monthlyCents);
    expect(months).toBeLessThanOrEqual(6);
    expect(DEFAULT_HOLD_DAYS).toBeLessThanOrEqual(45);
  });
});
