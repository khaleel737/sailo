import { describe, expect, it } from "vitest";
import {
  billingState,
  deltaOf,
  formatCurrencyTotals,
  mergeCurrencyTotals,
  planMonthlyCents,
  rollUpRevenue,
  share,
  type BillingGroup,
  type BillingRow,
} from "@/lib/metrics";
import { isStaffEmail, staffEmails } from "@sailo/security/staff";
import { PLANS } from "@sailo/core/plans";

const shop = (over: Partial<BillingRow> = {}): BillingRow => ({
  plan: "free",
  subscriptionStatus: null,
  subscriptionInterval: null,
  compPlan: null,
  ...over,
});

describe("billingState", () => {
  it("reads a live subscription as paying", () => {
    expect(billingState(shop({ plan: "pro", subscriptionStatus: "active" }))).toBe(
      "paying",
    );
  });

  it("keeps trialing and past_due apart from paying", () => {
    expect(
      billingState(shop({ plan: "pro", subscriptionStatus: "trialing" })),
    ).toBe("trialing");
    expect(
      billingState(shop({ plan: "pro", subscriptionStatus: "past_due" })),
    ).toBe("past_due");
  });

  it("treats every other Stripe status as canceled", () => {
    for (const status of ["canceled", "unpaid", "incomplete", "paused"]) {
      expect(billingState(shop({ plan: "business", subscriptionStatus: status }))).toBe(
        "canceled",
      );
    }
  });

  it("reads a paid plan with no status as free — the checkout never finished", () => {
    expect(billingState(shop({ plan: "business" }))).toBe("free");
  });

  it("lets a comp outrank whatever Stripe says", () => {
    expect(
      billingState(
        shop({
          plan: "business",
          subscriptionStatus: "canceled",
          compPlan: "pro",
        }),
      ),
    ).toBe("comped");
  });
});

describe("planMonthlyCents", () => {
  it("bills a monthly plan at its list price", () => {
    expect(
      planMonthlyCents(
        shop({ plan: "pro", subscriptionStatus: "active", subscriptionInterval: "month" }),
      ),
    ).toBe(PLANS.pro.monthlyCents);
  });

  it("spreads a yearly plan across the year rather than spiking one month", () => {
    const yearly = planMonthlyCents(
      shop({
        plan: "business",
        subscriptionStatus: "active",
        subscriptionInterval: "year",
      }),
    );
    expect(yearly).toBe(Math.round(PLANS.business.yearlyCents / 12));
    // The discount is the point: a year up front must be worth less per month.
    expect(yearly).toBeLessThan(PLANS.business.monthlyCents);
  });

  it("counts a comped account as zero revenue", () => {
    expect(
      planMonthlyCents(
        shop({ plan: "business", subscriptionStatus: "active", compPlan: "business" }),
      ),
    ).toBe(0);
  });

  it("counts free accounts as zero", () => {
    expect(planMonthlyCents(shop())).toBe(0);
  });
});

describe("rollUpRevenue", () => {
  const rows: BillingGroup[] = [
    { ...shop({ plan: "pro", subscriptionStatus: "active", subscriptionInterval: "month" }), accounts: 3 },
    { ...shop({ plan: "business", subscriptionStatus: "active", subscriptionInterval: "month" }), accounts: 2 },
    { ...shop({ plan: "business", subscriptionStatus: "past_due", subscriptionInterval: "month" }) },
    { ...shop({ plan: "pro", subscriptionStatus: "trialing", subscriptionInterval: "month" }) },
    { ...shop({ plan: "business", subscriptionStatus: "active", compPlan: "business" }) },
    { ...shop(), accounts: 10 },
  ];

  const rollup = rollUpRevenue(rows);

  it("counts MRR from active subscriptions only", () => {
    expect(rollup.mrrCents).toBe(
      PLANS.pro.monthlyCents * 3 + PLANS.business.monthlyCents * 2,
    );
  });

  it("reports failing renewals separately, as revenue at risk", () => {
    expect(rollup.atRiskCents).toBe(PLANS.business.monthlyCents);
    expect(rollup.mrrCents).not.toContain(PLANS.business.monthlyCents * 3);
  });

  it("keeps trials out of MRR but names what they would add", () => {
    expect(rollup.trialCents).toBe(PLANS.pro.monthlyCents);
  });

  it("values comps at list price without booking them as revenue", () => {
    expect(rollup.compedValueCents).toBe(PLANS.business.monthlyCents);
    expect(rollup.counts.comped).toBe(1);
  });

  it("expands grouped rows by their account count", () => {
    expect(rollup.counts.paying).toBe(5);
    expect(rollup.counts.free).toBe(10);
  });

  it("annualises and averages off the same MRR", () => {
    expect(rollup.arrCents).toBe(rollup.mrrCents * 12);
    expect(rollup.arpaCents).toBe(Math.round(rollup.mrrCents / 5));
  });

  it("splits MRR by plan, biggest first", () => {
    expect(rollup.byPlan.map((p) => p.plan)).toEqual(["business", "pro"]);
    expect(rollup.byPlan.reduce((sum, p) => sum + p.mrrCents, 0)).toBe(
      rollup.mrrCents,
    );
  });

  it("has no revenue to report when nobody is paying", () => {
    const empty = rollUpRevenue([]);
    expect(empty.mrrCents).toBe(0);
    expect(empty.arpaCents).toBe(0);
    expect(empty.byPlan).toEqual([]);
  });
});

describe("mergeCurrencyTotals", () => {
  it("keeps currencies apart and orders them by size", () => {
    expect(
      mergeCurrencyTotals([
        { currency: "EUR", cents: 500 },
        { currency: "USD", cents: 1000 },
        { currency: "EUR", cents: 700 },
      ]),
    ).toEqual([
      // EUR leads on the merged total, not on the order it arrived in.
      { currency: "EUR", cents: 1200 },
      { currency: "USD", cents: 1000 },
    ]);
  });

  it("folds case and drops empty totals", () => {
    expect(
      mergeCurrencyTotals([
        { currency: "usd", cents: 100 },
        { currency: "USD", cents: 50 },
        { currency: "GBP", cents: 0 },
      ]),
    ).toEqual([{ currency: "USD", cents: 150 }]);
  });

  it("never invents a combined figure", () => {
    const totals = mergeCurrencyTotals([
      { currency: "USD", cents: 100 },
      { currency: "NGN", cents: 100 },
    ]);
    expect(totals).toHaveLength(2);
    expect(formatCurrencyTotals(totals)).toContain("·");
  });
});

describe("formatCurrencyTotals", () => {
  it("names the ones it hides", () => {
    const totals = mergeCurrencyTotals([
      { currency: "USD", cents: 400 },
      { currency: "EUR", cents: 300 },
      { currency: "GBP", cents: 200 },
      { currency: "NGN", cents: 100 },
    ]);
    expect(formatCurrencyTotals(totals, 2)).toMatch(/\+2 more$/);
  });

  it("shows zero rather than nothing when there is no volume", () => {
    expect(formatCurrencyTotals([])).toBe("$0");
  });
});

describe("deltaOf", () => {
  it("reads growth as a percentage of the previous period", () => {
    expect(deltaOf(120, 100)).toEqual({
      value: "+20% vs previous",
      direction: "up",
    });
  });

  it("says so plainly when there was nothing to compare against", () => {
    expect(deltaOf(3, 0)).toEqual({ value: "+3 vs none", direction: "up" });
  });

  it("refuses a percentage of a base too small to take one of", () => {
    /*
     * The overview really did display "+21000% vs previous" — one registration
     * the week before, two hundred and eleven this week. It is arithmetically
     * correct and it reads as a broken number; the counts underneath are both
     * smaller and more useful.
     */
    expect(deltaOf(211, 1)).toEqual({ value: "211 vs 1", direction: "up" });
    expect(deltaOf(2, 9)).toEqual({ value: "2 vs 9", direction: "down" });
  });

  it("starts using percentages once the base can carry one", () => {
    expect(deltaOf(20, 10).value).toBe("+100% vs previous");
  });

  it("reports a fall", () => {
    expect(deltaOf(50, 100).direction).toBe("down");
  });

  it("has a word for no movement", () => {
    expect(deltaOf(7, 7)).toEqual({ value: "No change", direction: "flat" });
  });
});

describe("share", () => {
  it("rounds to whole percent", () => {
    expect(share(1, 3)).toBe(33);
  });

  it("survives an empty denominator", () => {
    expect(share(5, 0)).toBe(0);
  });
});

describe("the staff allowlist", () => {
  it("admits only the dedicated admin address by default", () => {
    expect(isStaffEmail("admin@sailo.store")).toBe(true);
    // The founders' personal inboxes, which the roster once named.
    expect(isStaffEmail("khaleelmusleh@gmail.com")).toBe(false);
    expect(isStaffEmail("uncolored.inc@gmail.com")).toBe(false);
  });

  it("ignores case and stray whitespace", () => {
    expect(isStaffEmail("  Admin@Sailo.store ")).toBe(true);
  });

  it("admits nobody else", () => {
    expect(isStaffEmail("someone@example.com")).toBe(false);
    expect(isStaffEmail(null)).toBe(false);
    expect(isStaffEmail("")).toBe(false);
  });

  it("does not treat a plus alias as the same account", () => {
    // Reaches the same inbox, but it is a different address to register.
    expect(isStaffEmail("admin+hq@sailo.store")).toBe(false);
  });

  it("is replaced wholesale by the environment variable", () => {
    const original = process.env.SAILO_STAFF_EMAILS;
    try {
      process.env.SAILO_STAFF_EMAILS = "ops@sailo.store, second@sailo.store";
      expect(staffEmails()).toEqual(["ops@sailo.store", "second@sailo.store"]);
      expect(isStaffEmail("ops@sailo.store")).toBe(true);
      expect(isStaffEmail("admin@sailo.store")).toBe(false);
    } finally {
      if (original === undefined) delete process.env.SAILO_STAFF_EMAILS;
      else process.env.SAILO_STAFF_EMAILS = original;
    }
  });

  it("falls back rather than locking everyone out on a blank variable", () => {
    const original = process.env.SAILO_STAFF_EMAILS;
    try {
      process.env.SAILO_STAFF_EMAILS = " , ";
      expect(staffEmails()).toHaveLength(1);
      expect(isStaffEmail("admin@sailo.store")).toBe(true);
    } finally {
      if (original === undefined) delete process.env.SAILO_STAFF_EMAILS;
      else process.env.SAILO_STAFF_EMAILS = original;
    }
  });
});
