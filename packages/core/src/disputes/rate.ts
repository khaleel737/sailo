/*
 * Dispute rates, and the three ways of getting them wrong.
 *
 * A dispute rate looks like one number and is really three questions, each with
 * a different denominator and a different consumer:
 *
 *   1. Are *we* about to be fined? — the ratio Visa and Mastercard compute,
 *      which is disputes that arrived this month over transactions that settled
 *      this month, per network, platform-wide.
 *   2. Is *this shop* a problem? — which is a different sum entirely, because a
 *      dispute that arrives in August belongs to an order from May.
 *   3. Is Sailo's money at risk right now? — which is not a ratio at all.
 *
 * Conflating the first two is the standard error in chargeback monitoring and it
 * fails in the one direction you cannot afford. A shop tripling its volume
 * month over month has its May disputes divided by its August orders, so a
 * seller running 6% fraud reads as 2% and clean. The faster they grow, the
 * cleaner they look, and growth is exactly what a fraud ring does.
 *
 * Everything here is integers and basis points. 150bp is 1.50%.
 */

/** How Sailo learned about a dispute, kept apart because they do not count alike. */
export type DisputeTally = {
  /**
   * Chargebacks. The only thing any network ratio counts.
   *
   * Excludes inquiries, whose whole purpose is to be settled without becoming
   * a chargeback, and which no network counts. Including them roughly doubles
   * the apparent rate — see `isInquiry` in `lifecycle.ts`.
   */
  chargebacks: number;
  /**
   * Chargebacks on a fraud reason, which Visa's VAMP counts on its own terms
   * and alongside TC40 fraud reports we never see.
   *
   * Reported separately because a shop at 0.4% overall but with every dispute
   * on `fraudulent` is a different problem from one at 0.4% on
   * `product_not_received`, and only the second is fixable by shipping faster.
   */
  fraudChargebacks: number;
  /** Inquiries. Reported to the seller, never divided by anything. */
  inquiries: number;
  /** Chargebacks that closed in Sailo's favour, for the win rate. */
  won: number;
  /** Chargebacks that closed against us. */
  lost: number;
};

export const EMPTY_TALLY: DisputeTally = {
  chargebacks: 0,
  fraudChargebacks: 0,
  inquiries: 0,
  won: 0,
  lost: 0,
};

/**
 * Basis points, or null when the denominator is too small to divide by.
 *
 * Null rather than zero, and rather than a number nobody may act on. One
 * dispute on three orders is 33% and means nothing at all; returned as 3333 it
 * is a number that will be sorted, charted, compared against a threshold and
 * eventually acted on by code written a year from now by someone who did not
 * read this comment. Null cannot be.
 */
export function ratioBp(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000);
}

/*
 * ---------------------------------------------------------------------------
 * Network thresholds
 * ---------------------------------------------------------------------------
 */

/**
 * The published monitoring thresholds, and what is actually known about them.
 *
 * These numbers decide whether Sailo gets fined, so they are stated with their
 * source and the date they were last reconciled rather than inlined as
 * folklore. Two of them are *known to move* — Visa's merchant threshold
 * tightened on 1 January 2026 and Mastercard replaced ECM with MMP on the same
 * date — which is the reason this is a table with a date on it and not four
 * constants scattered through the file.
 *
 * **Confirm against the acquirer before acting on the exact figures.** Sailo's
 * acquirer is Stripe, and Stripe's own enforcement is stricter and earlier than
 * the network's: an account can be restricted well before a network programme
 * would notice. So these are the ceiling, not the operating limit, and
 * `SAILO_THRESHOLDS` below is what the product actually runs on.
 */
export const NETWORK_THRESHOLDS_RECONCILED = "2026-08-17";

export type NetworkProgramme = {
  network: "visa" | "mastercard";
  programme: string;
  /** Ratio at which the programme takes an interest. */
  thresholdBp: number;
  /** Chargeback count below which the ratio is not applied at all. */
  minChargebacks: number;
  /**
   * Which month's transactions the ratio divides by.
   *
   * Not a detail. Mastercard divides this month's chargebacks by *last*
   * month's transaction count, so a shop that halves its volume sees its
   * Mastercard ratio double with no change in behaviour. Visa divides by the
   * same month.
   */
  denominator: "same_month" | "previous_month";
  source: string;
  /** True where the figure needs confirming rather than being relied on. */
  needsConfirmation: boolean;
};

export const NETWORK_PROGRAMMES: readonly NetworkProgramme[] = [
  {
    network: "visa",
    programme: "VAMP — above standard",
    /*
     * 1.5% from April 2025, 0.9% from January 2026. The tighter of the two is
     * the one to hold, because holding the looser one means discovering the
     * change by being fined for it.
     */
    thresholdBp: 90,
    minChargebacks: 1_000,
    denominator: "same_month",
    source: "Visa Acquirer Monitoring Program (VAMP), effective 2025-04-01, tightened 2026-01-01",
    needsConfirmation: true,
  },
  {
    network: "mastercard",
    programme: "MMP — excessive chargeback merchant",
    thresholdBp: 150,
    minChargebacks: 100,
    denominator: "previous_month",
    source: "Mastercard Merchant Monitoring Programme, from 2026-01-01 (replaced ECM)",
    needsConfirmation: true,
  },
  {
    network: "mastercard",
    programme: "MMP — high excessive",
    thresholdBp: 300,
    minChargebacks: 300,
    denominator: "previous_month",
    source: "Mastercard Merchant Monitoring Programme, from 2026-01-01",
    needsConfirmation: true,
  },
];

/**
 * What Sailo acts on, which is deliberately far below any network threshold.
 *
 * The network counts are platform-wide and in the thousands: Sailo would have
 * to be carrying a great deal of fraud across a great many shops before Visa's
 * 1,000-chargeback floor was reached, and by then the fine is not the problem —
 * the problem is that Stripe holds the losses against Sailo's own account
 * (`payments-compliance.md` §3.2) and has already reserved against it.
 *
 * So the operating thresholds are per shop, and their job is to catch the one
 * shop that would eventually take the platform over. 100bp — one dispute in a
 * hundred orders — is roughly where card processors start asking questions and
 * is an order of magnitude above what an honest shop produces.
 */
export const SAILO_THRESHOLDS = {
  /** Where a shop starts being watched. Informational; nothing acts on it. */
  watchBp: 50,
  /**
   * Where a human is asked to look — and it has to be *below* Visa's 90bp.
   *
   * This was 100bp and that was wrong in a way worth recording: it put Sailo's
   * first look after the point at which the shop had already taken the platform
   * over Visa's own merchant threshold. A monitoring programme whose first alarm
   * fires once you are already in breach is a reporting tool, not a control.
   * `rate.test.ts` asserts the ordering so the two cannot drift apart again.
   */
  reviewBp: 75,
  /** Where payouts are held pending that look — Mastercard's excessive line. */
  payoutHoldBp: 150,
} as const;

/*
 * ---------------------------------------------------------------------------
 * Floors
 * ---------------------------------------------------------------------------
 */

/**
 * The counts below which a ratio may not act, per rung of the ladder.
 *
 * Both sides are floored, and the numerator floor is the one that does the
 * work. A denominator floor alone still lets a single chargeback on the
 * twenty-sixth order read as 385bp and trip a threshold — so a shop is not
 * acted on until there is a *pattern*, which starts at two.
 *
 * This is Mastercard's own shape (100 chargebacks **and** 1.5%), scaled to a
 * platform whose shops sell in tens rather than tens of thousands. The failure
 * mode being designed against is precise: suspending hobbyists while missing
 * professionals. A professional running 3% on 2,000 orders clears every floor
 * here comfortably; a florist with one angry customer clears none of them.
 */
export const RATE_FLOORS = {
  review: { minChargebacks: 2, minSettledOrders: 25 },
  payoutHold: { minChargebacks: 3, minSettledOrders: 50 },
} as const;

export type RateFloor = { minChargebacks: number; minSettledOrders: number };

export function meetsFloor(
  tally: Pick<DisputeTally, "chargebacks">,
  settledOrders: number,
  floor: RateFloor,
): boolean {
  return (
    tally.chargebacks >= floor.minChargebacks &&
    settledOrders >= floor.minSettledOrders
  );
}

/*
 * ---------------------------------------------------------------------------
 * Cohorts, and the lag that makes them necessary
 * ---------------------------------------------------------------------------
 */

/**
 * How long after an order a dispute can still arrive.
 *
 * Visa and Mastercard both give a cardholder 120 days from the transaction (or
 * from the promised delivery date, which can be later) to raise most dispute
 * types, and some run to 540. 120 is the figure that matters for measurement:
 * until an order cohort is 120 days old, its disputes have not all arrived.
 */
export const DISPUTE_LAG_DAYS = 120;

/**
 * How complete a cohort's dispute count is.
 *
 * The reason this type exists rather than a boolean: an immature cohort's ratio
 * is not *wrong*, it is a **lower bound**. A cohort three weeks old showing
 * 300bp is already alarming and should be acted on; the same cohort showing 0bp
 * proves nothing whatsoever. Treating the two alike in either direction is a
 * mistake, and a boolean cannot carry the difference.
 */
export type CohortMaturity = "immature" | "maturing" | "mature";

export function cohortMaturity(
  cohortEnd: Date,
  now: Date,
  lagDays = DISPUTE_LAG_DAYS,
): CohortMaturity {
  const days = (now.getTime() - cohortEnd.getTime()) / 86_400_000;
  if (days >= lagDays) return "mature";
  // Half the window: most disputes that are coming have arrived, and the
  // number is worth showing with a caveat rather than withholding.
  if (days >= lagDays / 2) return "maturing";
  return "immature";
}

/**
 * A shop's disputes divided by the orders they actually came from.
 *
 * `settledOrders` counts orders *created in this window* that took money;
 * `tally` counts disputes **against those orders**, whenever the dispute itself
 * arrived. That attribution is the whole point and it is the opposite of what
 * a naive query does — `where dispute.created_at between …` reads fast, looks
 * right and answers a question nobody asked.
 */
export type Cohort = {
  /** Inclusive start of the order window. */
  start: Date;
  /** Exclusive end of the order window. */
  end: Date;
  /** Orders created in the window that took money. */
  settledOrders: number;
  /** Disputes raised against those orders, whenever they arrived. */
  tally: DisputeTally;
};

export type CohortRate = Cohort & {
  maturity: CohortMaturity;
  /** Chargebacks over settled orders, in basis points. Null below the floor. */
  chargebackBp: number | null;
  /** Fraud-reason chargebacks over settled orders. */
  fraudBp: number | null;
  /**
   * The ratio as an unfloored figure, for display only.
   *
   * Separate from `chargebackBp` so a table can show "1 of 3" honestly without
   * any threshold being able to read it. Never compare this to a threshold.
   */
  displayBp: number | null;
};

export function rateCohort(cohort: Cohort, now: Date): CohortRate {
  const floored = meetsFloor(
    cohort.tally,
    cohort.settledOrders,
    RATE_FLOORS.review,
  );
  return {
    ...cohort,
    maturity: cohortMaturity(cohort.end, now),
    chargebackBp: floored
      ? ratioBp(cohort.tally.chargebacks, cohort.settledOrders)
      : null,
    fraudBp: floored
      ? ratioBp(cohort.tally.fraudChargebacks, cohort.settledOrders)
      : null,
    displayBp: ratioBp(cohort.tally.chargebacks, cohort.settledOrders),
  };
}

/**
 * The rate a decision is actually taken on: every mature cohort, pooled.
 *
 * Pooled rather than averaged. Averaging per-cohort percentages weights a month
 * with four orders the same as a month with four hundred, which is how one bad
 * quiet month convicts a shop that has since sold thousands cleanly. Summing
 * both sides first is the only version that answers "out of everything this
 * shop has sold, how much came back".
 *
 * Immature cohorts are excluded from the denominator *and* the numerator, so a
 * shop cannot dilute a bad history by launching a big month — the orders it has
 * not had time to be disputed on do not count towards looking clean. Their
 * disputes are surfaced separately by `emergingRisk`.
 */
export function pooledRate(
  cohorts: readonly CohortRate[],
): { settledOrders: number; tally: DisputeTally; chargebackBp: number | null } {
  const mature = cohorts.filter((c) => c.maturity !== "immature");
  const settledOrders = mature.reduce((n, c) => n + c.settledOrders, 0);
  const tally = mature.reduce<DisputeTally>(
    (acc, c) => ({
      chargebacks: acc.chargebacks + c.tally.chargebacks,
      fraudChargebacks: acc.fraudChargebacks + c.tally.fraudChargebacks,
      inquiries: acc.inquiries + c.tally.inquiries,
      won: acc.won + c.tally.won,
      lost: acc.lost + c.tally.lost,
    }),
    EMPTY_TALLY,
  );

  return {
    settledOrders,
    tally,
    chargebackBp: meetsFloor(tally, settledOrders, RATE_FLOORS.review)
      ? ratioBp(tally.chargebacks, settledOrders)
      : null,
  };
}

/**
 * Disputes already arrived against cohorts too young to have a rate.
 *
 * The counterpart to excluding immature cohorts, and the reason that exclusion
 * is safe. A shop three weeks old with four chargebacks has no measurable rate
 * — and needs looking at immediately, because four disputes on three weeks of
 * trading is the shape of a fraud ring rather than of a bad month. A count
 * beats a ratio here, because the ratio's denominator is the thing that has not
 * happened yet.
 */
export function emergingRisk(cohorts: readonly CohortRate[]): number {
  return cohorts
    .filter((c) => c.maturity === "immature")
    .reduce((n, c) => n + c.tally.chargebacks, 0);
}

/**
 * Chargebacks arriving on brand-new cohorts that on their own justify a look,
 * whatever the rate says.
 *
 * Three, matching `RATE_FLOORS.payoutHold.minChargebacks`: the number of
 * separate cardholders that stops being coincidence.
 */
export const EMERGING_RISK_CHARGEBACKS = 3;

/**
 * The win rate, over decided chargebacks only.
 *
 * Denominator is `won + lost`, not `chargebacks`: a dispute still under review
 * has not been won or lost, and counting it as a loss makes every measurement
 * taken during a busy month look like a collapse in performance. Null until
 * something has actually been decided.
 *
 * This is the number that says whether the evidence pipeline works. A platform
 * submitting complete evidence wins a meaningful share of `product_not_received`
 * and `unrecognized` cases and very little of `fraudulent` without CE3.0 —
 * so a win rate near zero on fraud is a signal about `orders.buyerIp`, not
 * about the sellers.
 */
export function winRateBp(tally: DisputeTally): number | null {
  const decided = tally.won + tally.lost;
  if (decided === 0) return null;
  return ratioBp(tally.won, decided);
}

/** 150bp → "1.50%". */
export function formatBp(bp: number | null): string {
  if (bp === null) return "—";
  return `${(bp / 100).toFixed(2)}%`;
}
