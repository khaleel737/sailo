import { describe, expect, it } from "vitest";
import { PAUSED_STATUS, membershipAccess } from "./memberships";
import {
  MAX_SEATS,
  cancelVerdict,
  normalizeCycles,
  pauseVerdict,
  pausedDays,
  periodEndAfterPause,
  seatVerdict,
  termState,
} from "./terms";

/**
 * Membership depth, in the half that has no database — spec 49.
 *
 * The two properties this file exists to pin are the ones the whole spec is
 * written under:
 *
 *   * **`membershipAccess` gained exactly one branch.** Term complete *and*
 *     access retained. Everything else that closes a door — a lapsed period, a
 *     cancellation, a freeze — closes it through the predicate that was
 *     already there.
 *   * **Pause is a status, not a second predicate.** `paused` is simply not in
 *     `OPEN_STATUSES`, which is why the download gate, the members list, the
 *     door pass and the renewal cron all close for a frozen member with no
 *     code change at all.
 */

const NOW = new Date("2026-08-11T12:00:00Z");
const PERIOD_END = new Date("2026-09-01T00:00:00Z");

const sub = (over: Partial<Parameters<typeof membershipAccess>[0]> = {}) => ({
  status: "active",
  currentPeriodEnd: PERIOD_END,
  cancelAtPeriodEnd: false,
  ...over,
});

describe("the one new access branch", () => {
  it("keeps the door open after a completed term when the seller said so", () => {
    // A course sold in three payments, all three made. The subscription is
    // genuinely over — status cancelled, billing stopped, period end in the
    // past — and access continues because that is what was sold.
    const access = membershipAccess(
      sub({
        status: "canceled",
        currentPeriodEnd: new Date("2026-01-01T00:00:00Z"),
        endedReason: "term_complete",
        accessAfterTerm: true,
      }),
      NOW,
    );
    expect(access.open).toBe(true);
    expect(access.until).toBeNull();
  });

  it("closes it after a completed term when the seller did not", () => {
    expect(
      membershipAccess(
        sub({
          status: "canceled",
          currentPeriodEnd: new Date("2026-01-01T00:00:00Z"),
          endedReason: "term_complete",
          accessAfterTerm: false,
        }),
        NOW,
      ).open,
    ).toBe(false);
  });

  /*
   * The half that stops the branch being a hole. Without `endedReason`, a
   * member who quit a twelve-cycle course after one payment would keep the
   * whole course — they are `canceled` with `accessAfterTerm` snapshotted true,
   * and only the reason tells the two apart.
   */
  it("does not keep the door open for somebody who cancelled early", () => {
    expect(
      membershipAccess(
        sub({
          status: "canceled",
          currentPeriodEnd: new Date("2026-01-01T00:00:00Z"),
          endedReason: "canceled",
          accessAfterTerm: true,
        }),
        NOW,
      ).open,
    ).toBe(false);
  });

  it("answers exactly as it always did for a subscription with neither column", () => {
    // Every caller that selects the three columns this function has always
    // read keeps compiling and keeps getting the same answer.
    expect(membershipAccess(sub(), NOW).open).toBe(true);
    expect(
      membershipAccess(
        sub({ currentPeriodEnd: new Date("2026-01-01T00:00:00Z") }),
        NOW,
      ).open,
    ).toBe(false);
  });
});

describe("pause closes the door without a second predicate", () => {
  it("is closed while frozen, through the status alone", () => {
    expect(membershipAccess(sub({ status: PAUSED_STATUS }), NOW).open).toBe(false);
  });

  it("is closed even with a period end far in the future", () => {
    // A pause that kept access would be a free month, and the whole point is
    // that the member is not using it.
    expect(
      membershipAccess(
        sub({ status: PAUSED_STATUS, currentPeriodEnd: new Date("2030-01-01") }),
        NOW,
      ).open,
    ).toBe(false);
  });
});

describe("counting cycles", () => {
  it("is complete once the last one is paid", () => {
    expect(termState({ termCycles: 3, cyclesPaid: 3 }).complete).toBe(true);
    expect(termState({ termCycles: 3, cyclesPaid: 2 }).complete).toBe(false);
  });

  it("is never complete when the membership is open-ended", () => {
    const state = termState({ termCycles: null, cyclesPaid: 40 });
    expect(state.complete).toBe(false);
    expect(state.remaining).toBeNull();
  });

  it("reports what is left, and never a negative", () => {
    expect(termState({ termCycles: 3, cyclesPaid: 1 }).remaining).toBe(2);
    expect(termState({ termCycles: 3, cyclesPaid: 9 }).remaining).toBe(0);
  });

  /*
   * One cycle is refused rather than clamped. A one-cycle membership is a
   * one-off purchase wearing a subscription's clothes: Stripe would mint a
   * recurring price and cancel it immediately, and the buyer would have a
   * subscription in their portal for something that charged once.
   */
  it("refuses a term of one, and of zero", () => {
    expect(normalizeCycles(1)).toBeNull();
    expect(normalizeCycles(0)).toBeNull();
    expect(normalizeCycles(-3)).toBeNull();
    expect(normalizeCycles(2)).toBe(2);
  });

  it("refuses a term nobody can mean", () => {
    expect(normalizeCycles(null)).toBeNull();
    expect(normalizeCycles(Number.NaN)).toBeNull();
    expect(normalizeCycles(1_000_000)).toBe(520);
  });
});

describe("cancellation policy", () => {
  const inTerm = { termCycles: 12, cyclesPaid: 2, currentPeriodEnd: PERIOD_END };

  it("refuses inside a minimum term, and says how many are left", () => {
    expect(
      cancelVerdict(inTerm, { minimumTermCycles: 6, cancelNoticeDays: null }, NOW),
    ).toEqual({ allowed: false, reason: "minimum_term", cyclesLeft: 4 });
  });

  it("allows it once the minimum is served", () => {
    expect(
      cancelVerdict(
        { ...inTerm, cyclesPaid: 6 },
        { minimumTermCycles: 6, cancelNoticeDays: null },
        NOW,
      ),
    ).toEqual({ allowed: true, effectiveAt: PERIOD_END });
  });

  /*
   * A notice period is never a refusal — it moves the date. A member who gives
   * notice a day late is cancelling the *next* period, which is what a notice
   * period means everywhere it exists, and telling them "no" would be a button
   * that does nothing on the one screen where they are already frustrated.
   */
  it("moves the date rather than refusing when notice is late", () => {
    // Fourteen days' notice against a period ending on the 1st: the deadline
    // was the 18th of August and it is the 11th, so this one is in time.
    expect(
      cancelVerdict(inTerm, { minimumTermCycles: null, cancelNoticeDays: 14 }, NOW),
    ).toEqual({ allowed: true, effectiveAt: PERIOD_END });

    // Thirty days' notice against the same period end: the deadline was the
    // 2nd of August and has passed.
    expect(
      cancelVerdict(inTerm, { minimumTermCycles: null, cancelNoticeDays: 30 }, NOW),
    ).toEqual({ allowed: true, reason: "notice", effectiveAt: null });
  });

  it("allows it outright when no policy is set, which is every membership today", () => {
    expect(
      cancelVerdict(inTerm, { minimumTermCycles: null, cancelNoticeDays: null }, NOW),
    ).toEqual({ allowed: true, effectiveAt: PERIOD_END });
  });
});

describe("pause", () => {
  const member = { status: "active", pausedUntil: null, pauseDaysUsed: 0 };

  it("is not offered unless the seller turned it on", () => {
    expect(pauseVerdict(member, { pauseMaxDays: null }, 14, NOW)).toEqual({
      allowed: false,
      reason: "not_offered",
    });
  });

  it("freezes for the days asked, up to the allowance", () => {
    const verdict = pauseVerdict(member, { pauseMaxDays: 30 }, 14, NOW);
    expect(verdict).toMatchObject({ allowed: true, days: 14 });
    expect(verdict.allowed && verdict.until.toISOString()).toBe(
      new Date(NOW.getTime() + 14 * 86_400_000).toISOString(),
    );
  });

  /*
   * Refused with the number rather than silently clamped — rule 8. A member
   * who asked for thirty days and was given seven without being told finds out
   * when the door does not open.
   */
  it("refuses more than the allowance and says how many are left", () => {
    expect(
      pauseVerdict({ ...member, pauseDaysUsed: 24 }, { pauseMaxDays: 30 }, 14, NOW),
    ).toEqual({ allowed: false, reason: "too_long", daysLeft: 6 });
  });

  it("refuses a second freeze while one is running", () => {
    expect(
      pauseVerdict({ ...member, status: PAUSED_STATUS }, { pauseMaxDays: 30 }, 7, NOW),
    ).toEqual({ allowed: false, reason: "already_paused" });
  });

  it("carries the paid-for time rather than spending it", () => {
    // Froze on the 11th, back on the 18th: the period end moves by seven days,
    // so a member with eleven days left still has eleven days left.
    const pausedAt = NOW;
    const resumedAt = new Date("2026-08-18T12:00:00Z");
    const moved = periodEndAfterPause(PERIOD_END, pausedAt, resumedAt);
    expect(moved?.toISOString()).toBe(
      new Date(PERIOD_END.getTime() + 7 * 86_400_000).toISOString(),
    );
  });

  it("charges a part-day as a whole one, so a freeze is never free", () => {
    expect(pausedDays(NOW, new Date("2026-08-11T13:00:00Z"))).toBe(1);
    expect(pausedDays(NOW, new Date("2026-08-18T12:00:00Z"))).toBe(7);
    expect(pausedDays(null, NOW)).toBe(0);
  });

  it("leaves a membership with no period end alone", () => {
    expect(periodEndAfterPause(null, NOW, NOW)).toBeNull();
  });
});

describe("seats", () => {
  it("refuses a count below what people have accepted, with the number", () => {
    expect(seatVerdict(3, 5)).toEqual({
      allowed: false,
      reason: "below_accepted",
      accepted: 5,
    });
  });

  it("allows a count at or above it", () => {
    expect(seatVerdict(5, 5)).toEqual({ allowed: true, seats: 5 });
    expect(seatVerdict(8, 5)).toEqual({ allowed: true, seats: 8 });
  });

  it("never goes below one, and never past the ceiling", () => {
    expect(seatVerdict(0, 0)).toEqual({ allowed: true, seats: 1 });
    expect(seatVerdict(10_000, 0)).toEqual({ allowed: true, seats: MAX_SEATS });
  });
});
