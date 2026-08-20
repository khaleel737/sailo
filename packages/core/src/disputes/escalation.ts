/*
 * What to do about a shop that is producing disputes.
 *
 * The instinct is to take the storefront off the air, and it is the wrong first
 * move on both counts. It does not protect the money — the exposure is the
 * balance about to be paid out, not the sales that have not happened yet — and
 * it is not reversible in the way that matters: a seller whose shop went dark
 * for a day has told their customers something about Sailo that clearing the
 * flag does not untell.
 *
 * So the ladder is ordered by what it costs to be wrong:
 *
 *   watch        nothing happens. A number moves in /hq.
 *   review       a human is asked to look. Nothing happens to the seller.
 *   payout_hold  payouts switch to manual. The seller keeps selling, keeps
 *                being paid *eventually*, and their money stays in their own
 *                Stripe balance where a dispute can still be debited from it.
 *                One API call undoes it and the seller may never notice.
 *   suspend      the storefront closes. Never automatic — see below.
 *
 * Only the first three are reachable from a rate. `suspend` is returned as a
 * *recommendation* and is applied by a person, because the difference between a
 * fraud ring and a shop that had a terrible month is a judgement no threshold
 * can make, and the cost of getting it wrong falls entirely on a real business.
 */

import {
  EMERGING_RISK_CHARGEBACKS,
  RATE_FLOORS,
  SAILO_THRESHOLDS,
  meetsFloor,
  type DisputeTally,
} from "./rate";
import { centsToAmount } from "../money/parse";

export const ESCALATION_LEVELS = [
  "clear",
  "watch",
  "review",
  "payout_hold",
  "suspend",
] as const;

export type EscalationLevel = (typeof ESCALATION_LEVELS)[number];

const RANK: Record<EscalationLevel, number> = {
  clear: 0,
  watch: 1,
  review: 2,
  payout_hold: 3,
  suspend: 4,
};

export function isHigherLevel(a: EscalationLevel, b: EscalationLevel): boolean {
  return RANK[a] > RANK[b];
}

/**
 * The highest rung this decision may apply on its own.
 *
 * `payout_hold`, and the boundary is deliberate rather than cautious. Everything
 * up to and including it is reversible without the seller losing anything they
 * cannot get back; `suspend` is not, so it needs a person who has looked.
 */
export const MAX_AUTOMATIC_LEVEL: EscalationLevel = "payout_hold";

export function isAutomatic(level: EscalationLevel): boolean {
  return RANK[level] <= RANK[MAX_AUTOMATIC_LEVEL];
}

/**
 * What Sailo stands to lose that it cannot recover from the seller.
 *
 * This is the number the whole feature exists for, and it is not a ratio.
 *
 * Sailo runs direct charges on Express accounts, which makes
 * `controller.losses.payments = application`: the platform is the losses
 * collector. When a chargeback lands, Stripe debits the *seller's* balance — but
 * if that balance cannot cover it the account goes negative, and after 180
 * negative days Stripe takes the shortfall from Sailo's own reserve
 * (`payments-compliance.md` §3.2). Terms clause 5 passes the shortfall back to
 * the seller contractually, which is the correct drafting and arrives second.
 *
 * So the money at risk is whatever the open disputes exceed the seller's balance
 * by. Verified against the API: a $42 chargeback debits $57 — the amount plus a
 * $15 dispute fee — so the fee belongs in the exposure and is easy to leave out.
 */
export type Exposure = {
  /**
   * Amount plus fee for every dispute where the money is out and the outcome
   * is not yet decided, in the shop's currency's minor units.
   */
  openDisputeCents: number;
  /** What the connected account holds that a debit could still come out of. */
  balanceCents: number;
  /** Already negative, if the balance has gone under. Positive number. */
  negativeBalanceCents: number;
};

/**
 * What Sailo would cover, without counting the same money twice.
 *
 * The obvious arithmetic is a sum, and it is wrong — found by a live run rather
 * than by a test. A real $600 chargeback on a connected account with no other
 * balance produced: open disputes $615, available balance $0, *negative* balance
 * $615, and a reported exposure of **$1,230**. The two figures are the same
 * money seen twice: Stripe debits the balance when the chargeback lands, which
 * is what made it negative in the first place.
 *
 * So it is the worse of the two views, not their total:
 *
 *   - `openDisputeCents - balanceCents` — what the open cases exceed the
 *     account's holdings by. The forward-looking view.
 *   - `negativeBalanceCents` — what the account is *already* short. The realised
 *     view, and the one with a 180-day clock on it before Stripe takes it from
 *     Sailo's reserve.
 *
 * Where a debit has already landed the two agree, and `max` reports it once.
 * Where a dispute is open but not yet debited only the first is non-zero. Where
 * an account went negative for some other reason — a refund, a Stripe fee — only
 * the second is, and it still belongs to Sailo. No case wants them added.
 */
export function unrecoverableCents(exposure: Exposure): number {
  return Math.max(
    Math.max(0, exposure.openDisputeCents - exposure.balanceCents),
    exposure.negativeBalanceCents,
  );
}

/**
 * The shortfall at which payouts are held regardless of any rate.
 *
 * $250. Below it the exposure is smaller than the cost of a false positive — a
 * held payout is a seller who cannot pay their own supplier — and one $15
 * dispute fee on a small order should never reach for this. Above it the money
 * is leaving on the next payout run and will not come back.
 *
 * A flat figure rather than a share of the balance, because the loss is flat:
 * Stripe debits the seller's balance and the platform covers whatever is not
 * there, and neither number cares how big the shop is.
 */
export const EXPOSURE_HOLD_CENTS = 25_000;

export type ShopRisk = {
  /** Pooled over mature cohorts. Null when below the floor. */
  chargebackBp: number | null;
  /** Mature settled orders — the pooled denominator. */
  settledOrders: number;
  /** Pooled tally over mature cohorts. */
  tally: DisputeTally;
  /** Chargebacks on cohorts too young to have a rate. */
  emergingChargebacks: number;
  exposure: Exposure;
  /**
   * When a human last looked and said this shop was fine.
   *
   * Without it, a shop cleared by staff is re-flagged by the next run of the
   * same arithmetic that flagged it the first time, which is how an automated
   * check teaches everybody to ignore it. A clearance holds until the facts
   * change — see `CLEARANCE_GRACE_CHARGEBACKS`.
   */
  clearedAt: Date | null;
  /** Chargebacks the shop had when it was cleared. */
  chargebacksAtClearance: number;
};

/**
 * How many *new* chargebacks it takes to override a staff clearance.
 *
 * Two. A clearance is a judgement about a shop, not a permanent exemption, and
 * the thing that should reopen it is new evidence rather than the passage of
 * time — so this is counted in disputes rather than days.
 */
export const CLEARANCE_GRACE_CHARGEBACKS = 2;

export type EscalationDecision = {
  level: EscalationLevel;
  /**
   * Why, in a sentence, written to be read by the seller as well as by staff.
   *
   * Stored in `shops.payoutsPausedReason`, so it outlives the numbers that
   * produced it. "High dispute rate" tells the next person nothing; the figures
   * that tripped it tell them whether it was right.
   */
  reason: string;
  /** Whether code may apply this, or whether it only recommends it. */
  automatic: boolean;
  /** The exposure figure that justified a hold, when that is what did. */
  unrecoverableCents: number;
};

/**
 * What should happen to this shop, from facts alone.
 *
 * Pure: no clock beyond the one passed in, no database, no Stripe. Every rung
 * is reachable in a test with plain numbers, which is the only way thresholds
 * this consequential get to be trusted.
 */
export function assessShop(risk: ShopRisk): EscalationDecision {
  const shortfall = unrecoverableCents(risk.exposure);
  const newSinceClearance = risk.clearedAt
    ? risk.tally.chargebacks - risk.chargebacksAtClearance
    : risk.tally.chargebacks;
  const cleared =
    risk.clearedAt !== null &&
    newSinceClearance < CLEARANCE_GRACE_CHARGEBACKS;

  // Platform money is USD; the $ prefix is staff-facing house style.
  const money = (cents: number) => `$${centsToAmount(cents, "USD")}`;

  /*
   * Exposure first, and it outranks a staff clearance.
   *
   * A clearance is a judgement that a shop's *behaviour* is acceptable. It is
   * not a decision to fund that shop's shortfall out of Sailo's reserve, and
   * nobody clearing a 120bp rate in /hq intended to authorise that. The money
   * question is asked again every time the number changes.
   */
  if (shortfall >= EXPOSURE_HOLD_CENTS) {
    return {
      level: "payout_hold",
      reason:
        `Open disputes of ${money(risk.exposure.openDisputeCents)} against a ` +
        `balance of ${money(risk.exposure.balanceCents)} leave ` +
        `${money(shortfall)} that Sailo would cover. Payouts held until the ` +
        `disputes close or the balance covers them.`,
      automatic: true,
      unrecoverableCents: shortfall,
    };
  }

  if (cleared) {
    return {
      level: "clear",
      reason: `Reviewed and cleared by staff; ${newSinceClearance} new chargeback(s) since.`,
      automatic: true,
      unrecoverableCents: shortfall,
    };
  }

  /*
   * A brand-new shop with several chargebacks, which no ratio can see.
   *
   * Its cohorts are immature, so `chargebackBp` is null and every threshold
   * below is unreachable — by design, because the denominator has not finished
   * happening. Three separate cardholders disputing inside the dispute window
   * is not a rate and does not need to be one.
   */
  if (risk.emergingChargebacks >= EMERGING_RISK_CHARGEBACKS) {
    return {
      level: "review",
      reason:
        `${risk.emergingChargebacks} chargebacks on orders too recent to have a ` +
        `meaningful rate. Too new to measure, too many to ignore.`,
      automatic: true,
      unrecoverableCents: shortfall,
    };
  }

  const bp = risk.chargebackBp;
  if (bp === null) {
    /*
     * Below the floor. Either nothing has been disputed, or too little has been
     * sold for the division to mean anything — `RATE_FLOORS.review` is two
     * chargebacks and twenty-five settled orders, and one dispute on three
     * orders is 33% and evidence of nothing.
     */
    return {
      level: risk.tally.chargebacks > 0 ? "watch" : "clear",
      reason:
        risk.tally.chargebacks > 0
          ? `${risk.tally.chargebacks} chargeback(s) on ${risk.settledOrders} settled ` +
            `order(s) — below the ${RATE_FLOORS.review.minChargebacks}-dispute, ` +
            `${RATE_FLOORS.review.minSettledOrders}-order floor for a rate to mean anything.`
          : "No chargebacks.",
      automatic: true,
      unrecoverableCents: shortfall,
    };
  }

  const pct = (bp / 100).toFixed(2);
  const basis =
    `${risk.tally.chargebacks} chargebacks on ${risk.settledOrders} settled orders ` +
    `(${pct}%), measured against the orders they came from`;

  if (
    bp >= SAILO_THRESHOLDS.payoutHoldBp &&
    meetsFloor(risk.tally, risk.settledOrders, RATE_FLOORS.payoutHold)
  ) {
    return {
      level: "payout_hold",
      reason:
        `${basis}, over the ${(SAILO_THRESHOLDS.payoutHoldBp / 100).toFixed(2)}% ` +
        `payout-hold threshold. Payouts held pending review; the storefront stays open.`,
      automatic: true,
      unrecoverableCents: shortfall,
    };
  }

  if (bp >= SAILO_THRESHOLDS.reviewBp) {
    return {
      level: "review",
      reason: `${basis}, over the ${(SAILO_THRESHOLDS.reviewBp / 100).toFixed(2)}% review threshold.`,
      automatic: true,
      unrecoverableCents: shortfall,
    };
  }

  if (bp >= SAILO_THRESHOLDS.watchBp) {
    return {
      level: "watch",
      reason: `${basis}, approaching the review threshold.`,
      automatic: true,
      unrecoverableCents: shortfall,
    };
  }

  return {
    level: "clear",
    reason: basis,
    automatic: true,
    unrecoverableCents: shortfall,
  };
}

/**
 * Whether staff should be *offered* suspension, having looked.
 *
 * Never returned by `assessShop`, because nothing automatic may reach it. This
 * is what /hq uses to decide whether to put the button in front of a human, and
 * the bar is a shop that is both far over the line and already on a payout hold
 * — that is, one where the reversible move has been made and did not help.
 */
export function suspensionWarranted(risk: ShopRisk, payoutsHeld: boolean): boolean {
  if (!payoutsHeld) return false;
  const bp = risk.chargebackBp;
  if (bp === null) return risk.emergingChargebacks >= EMERGING_RISK_CHARGEBACKS * 2;
  return bp >= SAILO_THRESHOLDS.payoutHoldBp * 2;
}
