/**
 * Fixed terms, cancellation policy and pause — the arithmetic half — spec 49.
 *
 * Pure and database-free on purpose. Every rule here is one a seller reads on
 * a form, a buyer reads at checkout and a cron acts on hours later, and the
 * three have to agree exactly: "you can cancel from the 3rd" on the product
 * page and a refusal on the 3rd is a support case, not a rounding error. A
 * rule computed in three places is a rule with three answers.
 *
 * `now` is injected everywhere for the same reason it is in `checkCoupon`: the
 * interesting cases are all boundaries, and a test that cannot move the clock
 * cannot reach them.
 */

/* -------------------------------------------------------------------------- */
/*  Fixed term                                                                */
/* -------------------------------------------------------------------------- */

export type TermState = {
  /** Null when the membership is open-ended, which is most of them. */
  cycles: number | null;
  paid: number;
  /** True once the last cycle has been paid for. */
  complete: boolean;
  /** Cycles still to pay. Null when open-ended. */
  remaining: number | null;
};

/**
 * Where a member is in their term.
 *
 * `cyclesPaid` counts *payments received*, so a 3-cycle course is complete
 * when the third one lands — not when the third one is raised. That is the
 * distinction the seller means by "three payments", and it is why the counter
 * is incremented in the statement that records a paid period rather than in
 * the one that asks for it.
 */
export function termState(subscription: {
  termCycles: number | null;
  cyclesPaid: number;
}): TermState {
  const cycles = normalizeCycles(subscription.termCycles);
  const paid = Math.max(0, subscription.cyclesPaid);

  if (cycles === null) {
    return { cycles: null, paid, complete: false, remaining: null };
  }
  return {
    cycles,
    paid,
    complete: paid >= cycles,
    remaining: Math.max(0, cycles - paid),
  };
}

/**
 * A cycle count a seller can mean.
 *
 * Zero and one are genuinely different and both are refused rather than
 * folded: zero cycles is a membership that ends before it starts, and a
 * *one*-cycle membership is a one-off purchase wearing a subscription's
 * clothes — Stripe would create a recurring price and cancel it immediately,
 * and the buyer would have a subscription in their portal for something that
 * charged once. Null is the honest answer to both, and null is open-ended.
 */
export function normalizeCycles(raw: number | null | undefined): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const cycles = Math.trunc(raw);
  return cycles >= 2 ? Math.min(cycles, MAX_TERM_CYCLES) : null;
}

/**
 * Ten years of weekly billing, which is longer than any seller means and short
 * enough that a typed `52000` cannot become a lifetime commitment.
 */
export const MAX_TERM_CYCLES = 520;

/* -------------------------------------------------------------------------- */
/*  Cancellation policy                                                       */
/* -------------------------------------------------------------------------- */

export type CancelPolicy = {
  minimumTermCycles: number | null;
  cancelNoticeDays: number | null;
};

export type CancelVerdict =
  /** They may cancel, and it takes effect at the end of the current period. */
  | { allowed: true; effectiveAt: Date | null }
  /** Not yet — they are inside a minimum term. */
  | { allowed: false; reason: "minimum_term"; cyclesLeft: number }
  /**
   * Too late for this period; the notice runs into the next one.
   *
   * Deliberately not a refusal to cancel at all — see the note below.
   */
  | { allowed: true; reason: "notice"; effectiveAt: Date | null };

/**
 * Whether a member may stop, and when it takes effect.
 *
 * TWO RULES THAT LOOK ALIKE AND ARE NOT
 *
 * A **minimum term** is a refusal: the seller sold twelve weeks and the member
 * is in week three. A **notice period** is never a refusal — it moves the date.
 * Conflating them would either trap a member who gave notice a day late, or
 * let one walk out of a term they agreed to.
 *
 * AND ONE RULE THAT IS NOT ENFORCEABLE AT ALL
 *
 * On the manual rail a member can always simply stop paying, and no column
 * here changes that. A minimum term governs what the seller may *say* about
 * it — and what a dispute will be argued from, through the policy snapshot —
 * not a lock Sailo can apply. The copy says so out loud rather than implying
 * an obligation we cannot enforce.
 */
export function cancelVerdict(
  subscription: {
    termCycles: number | null;
    cyclesPaid: number;
    currentPeriodEnd: Date | null;
  },
  policy: CancelPolicy,
  now = new Date(),
): CancelVerdict {
  const minimum = normalizeCycles(policy.minimumTermCycles);
  if (minimum !== null && subscription.cyclesPaid < minimum) {
    return {
      allowed: false,
      reason: "minimum_term",
      cyclesLeft: minimum - subscription.cyclesPaid,
    };
  }

  const notice = wholeDays(policy.cancelNoticeDays);
  const periodEnd = subscription.currentPeriodEnd;

  if (notice === null || !periodEnd) {
    return { allowed: true, effectiveAt: periodEnd };
  }

  /*
   * Inside the notice window, so this period cannot be the last one.
   *
   * The member still cancels — they are simply cancelling the *next* period
   * end rather than this one, which is what a notice period means everywhere
   * it exists. Returning `allowed: false` here would be a button that does
   * nothing, on the one screen where a member is already frustrated.
   */
  const deadline = new Date(periodEnd.getTime() - notice * 86_400_000);
  if (now.getTime() > deadline.getTime()) {
    return { allowed: true, reason: "notice", effectiveAt: null };
  }

  return { allowed: true, effectiveAt: periodEnd };
}

function wholeDays(raw: number | null | undefined): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const days = Math.trunc(raw);
  return days > 0 ? Math.min(days, 365) : null;
}

/* -------------------------------------------------------------------------- */
/*  Pause                                                                     */
/* -------------------------------------------------------------------------- */

export type PauseVerdict =
  | { allowed: true; until: Date; days: number }
  | { allowed: false; reason: "not_offered" }
  | { allowed: false; reason: "too_long"; daysLeft: number }
  | { allowed: false; reason: "already_paused" };

/**
 * Whether a member may freeze, and until when.
 *
 * `pauseMaxDays` null is "pausing is not offered", which is every membership
 * that exists today — the `0034` rule expressed as a feature switch rather
 * than a column default.
 *
 * `pauseDaysUsed` is a running total for the life of the subscription and it
 * is what stops a rolling permanent pause. Without it a member freezes for
 * twenty-eight days, resumes for a day and freezes again, for ever: a free
 * membership assembled out of legitimate requests, which nobody would notice
 * until the seller wondered why their busiest member never pays.
 */
export function pauseVerdict(
  subscription: {
    status: string;
    pausedUntil: Date | null;
    pauseDaysUsed: number;
  },
  product: { pauseMaxDays: number | null },
  days: number,
  now = new Date(),
): PauseVerdict {
  const max = wholeDays(product.pauseMaxDays);
  if (max === null) return { allowed: false, reason: "not_offered" };

  if (subscription.status === "paused" || subscription.pausedUntil) {
    return { allowed: false, reason: "already_paused" };
  }

  const wanted = Math.max(1, Math.trunc(days));
  const left = Math.max(0, max - Math.max(0, subscription.pauseDaysUsed));
  /*
   * Refused with the number rather than silently clamped — rule 8. A member
   * who asked for thirty days and got seven without being told has been
   * quietly short-changed, and they find out when the door does not open.
   */
  if (wanted > left) return { allowed: false, reason: "too_long", daysLeft: left };

  return {
    allowed: true,
    days: wanted,
    until: new Date(now.getTime() + wanted * 86_400_000),
  };
}

/**
 * Where the billing clock lands when a freeze lifts.
 *
 * The paid-for time is *carried*, not spent: a member who froze with eleven
 * days left has eleven days left when they come back, so the period end moves
 * forward by exactly the days they were away. Anything else charges somebody
 * for a month they were told they would not be charged for.
 *
 * On the card rail Stripe owns this — `pause_collection` with `behavior: void`
 * pushes its own clock and we mirror what it tells us. This is the manual
 * rail's arithmetic, and it is here rather than inline so the two can be
 * compared by reading rather than by inference.
 */
export function periodEndAfterPause(
  currentPeriodEnd: Date | null,
  pausedAt: Date | null,
  resumedAt: Date,
): Date | null {
  if (!currentPeriodEnd || !pausedAt) return currentPeriodEnd;
  const frozenMs = Math.max(0, resumedAt.getTime() - pausedAt.getTime());
  return new Date(currentPeriodEnd.getTime() + frozenMs);
}

/** Whole days a member was frozen, rounded up so a part-day is not free. */
export function pausedDays(pausedAt: Date | null, resumedAt: Date): number {
  if (!pausedAt) return 0;
  const ms = Math.max(0, resumedAt.getTime() - pausedAt.getTime());
  return Math.ceil(ms / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/*  Seats                                                                     */
/* -------------------------------------------------------------------------- */

export type SeatVerdict =
  | { allowed: true; seats: number }
  | { allowed: false; reason: "below_accepted"; accepted: number };

/**
 * Whether a seat count may be set to `wanted`.
 *
 * Reducing below the number of seats somebody has *accepted* is refused with
 * the number rather than silently truncated — rule 8. Truncating would pick
 * which employee loses their access, at random, on the seller's behalf, and
 * the first anybody would know is somebody being turned away at a door.
 */
export function seatVerdict(wanted: number, accepted: number): SeatVerdict {
  const seats = Math.max(1, Math.min(Math.trunc(wanted), MAX_SEATS));
  if (seats < accepted) return { allowed: false, reason: "below_accepted", accepted };
  return { allowed: true, seats };
}

/** A company buying more than this is having a conversation, not a checkout. */
export const MAX_SEATS = 500;
