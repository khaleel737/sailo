import { describe, expect, it } from "vitest";
import {
  BILLING_INTERVALS,
  addInterval,
  anyAccess,
  canStillInvoice,
  feeBpFromPercent,
  feePercentFromBp,
  isManual,
  nextPeriodEnd,
  intervalOf,
  isBillingInterval,
  membershipAccess,
  membershipSellable,
  normalizeTrialDays,
  priceIsStale,
} from "./memberships";

/**
 * The rules that decide whether a door opens.
 *
 * Every assertion here is about money somebody is still paying, or has stopped
 * paying, and the two failure directions are not equal: letting a lapsed
 * member in costs the seller a month; locking out a paid-up one costs them the
 * member. The tests are written to pin both.
 */

const sub = (over: Partial<Parameters<typeof membershipAccess>[0]> = {}) => ({
  status: "active",
  currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
  cancelAtPeriodEnd: false,
  ...over,
});

const NOW = new Date("2026-08-11T12:00:00Z");

describe("access", () => {
  it("opens for an active member inside their period", () => {
    expect(membershipAccess(sub(), NOW).open).toBe(true);
  });

  it("opens during a trial — they have not paid and they are still a member", () => {
    expect(membershipAccess(sub({ status: "trialing" }), NOW).open).toBe(true);
  });

  it("keeps a past_due member in while Stripe retries their card", () => {
    /*
     * The deliberate leniency. Stripe retries a failed card for days, and a
     * gym that locks the door the morning a card expires has punished a
     * member for their bank's fraud check — while its own dunning email is
     * still in flight.
     */
    expect(membershipAccess(sub({ status: "past_due" }), NOW).open).toBe(true);
  });

  it("closes when the paid period has run out, whatever the status says", () => {
    // The half that is easy to leave out: without it a `past_due` member
    // whose card never recovers keeps access forever, because Stripe can take
    // a week to move them to `canceled`.
    const lapsed = sub({
      status: "past_due",
      currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    });
    expect(membershipAccess(lapsed, NOW).open).toBe(false);
  });

  it("keeps a cancelled member in until the period they paid for ends", () => {
    const leaving = sub({ cancelAtPeriodEnd: true });
    const access = membershipAccess(leaving, NOW);
    expect(access.open).toBe(true);
    expect(access.endingSoon).toBe(true);
    expect(access.until).toEqual(new Date("2026-09-01T00:00:00Z"));
  });

  it("closes once a cancelled member's period is over", () => {
    const gone = sub({
      status: "canceled",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    });
    expect(membershipAccess(gone, NOW).open).toBe(false);
  });

  it("closes for a subscription that never started", () => {
    expect(membershipAccess(sub({ status: "incomplete" }), NOW).open).toBe(false);
  });

  it("closes for no subscription at all", () => {
    expect(membershipAccess(null, NOW).open).toBe(false);
  });

  it("treats a missing period end as open while the status is open", () => {
    // The seconds between `checkout.session.completed` and the first
    // `customer.subscription.updated`, during which the member has just paid.
    expect(membershipAccess(sub({ currentPeriodEnd: null }), NOW).open).toBe(true);
  });

  it("lets any one live subscription open the door", () => {
    expect(
      anyAccess(
        [sub({ status: "canceled", currentPeriodEnd: new Date("2020-01-01") }), sub()],
        NOW,
      ),
    ).toBe(true);
  });
});

describe("what may be sold as a membership", () => {
  const product = (over = {}) => ({
    kind: "membership",
    priceCents: 3_000,
    billingInterval: "month",
    ...over,
  });

  it("accepts a priced membership on a known interval", () => {
    expect(membershipSellable(product())).toBe(true);
  });

  it("refuses one priced at nothing — Stripe will not bill zero forever", () => {
    expect(membershipSellable(product({ priceCents: 0 }))).toBe(false);
  });

  it("refuses one with no interval, which nothing can schedule", () => {
    expect(membershipSellable(product({ billingInterval: null }))).toBe(false);
    expect(membershipSellable(product({ billingInterval: "week" }))).toBe(false);
  });

  it("refuses a product that is not a membership at all", () => {
    expect(membershipSellable(product({ kind: "digital" }))).toBe(false);
  });
});

describe("intervals and trials", () => {
  it("knows only the two Stripe recurring intervals we sell", () => {
    expect(BILLING_INTERVALS).toEqual(["month", "year"]);
    expect(isBillingInterval("month")).toBe(true);
    expect(isBillingInterval("week")).toBe(false);
    expect(isBillingInterval(null)).toBe(false);
  });

  it("falls back to monthly rather than guessing", () => {
    expect(intervalOf({ billingInterval: null })).toBe("month");
    expect(intervalOf({ billingInterval: "year" })).toBe("year");
  });

  it("folds a zero-day trial to none, because Stripe rejects zero", () => {
    // A seller typing 0 means "no trial", not "fail the checkout".
    expect(normalizeTrialDays(0)).toBeNull();
    expect(normalizeTrialDays("")).toBeNull();
    expect(normalizeTrialDays(-3)).toBeNull();
    expect(normalizeTrialDays(null)).toBeNull();
  });

  it("keeps a real trial and caps a silly one", () => {
    expect(normalizeTrialDays(14)).toBe(14);
    expect(normalizeTrialDays("7")).toBe(7);
    expect(normalizeTrialDays(10_000)).toBe(365);
  });
});

describe("whether the cached Stripe Price is still right", () => {
  const cached = (over = {}) => ({
    priceCents: 3_000,
    billingInterval: "month",
    stripePriceId: "price_123",
    stripePriceCents: 3_000,
    stripePriceInterval: "month",
    ...over,
  });

  it("is fresh when nothing has changed", () => {
    expect(priceIsStale(cached())).toBe(false);
  });

  it("is stale before a Price has ever been minted", () => {
    expect(priceIsStale(cached({ stripePriceId: null }))).toBe(true);
  });

  it("is stale the moment the seller changes the price", () => {
    /*
     * The one that matters. A Stripe Price is immutable, so a changed amount
     * needs a *new* Price — and missing this means every new subscriber is
     * charged last month's price forever, silently, on a row that looks right.
     */
    expect(priceIsStale(cached({ priceCents: 3_500 }))).toBe(true);
  });

  it("is stale when the cached amount was never recorded", () => {
    // A row from before the column existed cannot prove it is current.
    expect(priceIsStale(cached({ stripePriceCents: null }))).toBe(true);
  });

  it("is stale when the interval changed but the number did not", () => {
    /*
     * The one an amount-only check cannot see: £30 a month and £30 a year are
     * the same number, and keeping the old Price would go on billing monthly
     * for something the product now sells annually.
     */
    expect(priceIsStale(cached({ billingInterval: "year" }))).toBe(true);
  });
});

/**
 * The calendar arithmetic behind a manual renewal.
 *
 * On the card path Stripe owns all of this and we never compute a date. On
 * every other rail Sailo decides when the next period ends, and "a month" is
 * where naive implementations go wrong: 30 days walks a renewal backwards
 * through the year until a January signup is being billed in mid-December,
 * and `setMonth` on the 31st silently lands in the month after next.
 */
describe("moving a period on", () => {
  const at = (iso: string) => new Date(iso);

  it("adds a calendar month, not thirty days", () => {
    expect(addInterval(at("2026-01-15T09:00:00Z"), "month").toISOString()).toBe(
      "2026-02-15T09:00:00.000Z",
    );
  });

  it("clamps the 31st onto a shorter month instead of skipping it", () => {
    // 31 January + 1 month is 31 February, which JavaScript rolls into March.
    // A membership taken out on the 31st renews on the last day of the next
    // month; it does not skip a month entirely.
    const next = addInterval(at("2026-01-31T09:00:00Z"), "month");
    expect(next.getUTCMonth()).toBe(1); // February
    expect(next.getUTCDate()).toBe(28);
  });

  it("keeps the day of the month across a long run", () => {
    // The drift test: twelve hops from the 15th must still be the 15th.
    let date = at("2026-01-15T09:00:00Z");
    for (let i = 0; i < 12; i += 1) date = addInterval(date, "month");
    expect(date.getUTCDate()).toBe(15);
    expect(date.getUTCFullYear()).toBe(2027);
  });

  it("adds a year, and 29 February becomes 28 February", () => {
    expect(addInterval(at("2026-03-01T09:00:00Z"), "year").getUTCFullYear()).toBe(2027);
    const leap = addInterval(at("2028-02-29T09:00:00Z"), "year");
    expect(leap.getUTCMonth()).toBe(1);
    expect(leap.getUTCDate()).toBe(28);
  });

  it("counts from the period end, so paying late does not move the date", () => {
    /*
     * A member who pays three days after their renewal request keeps their
     * original date. Counting from *today* would push it later every period
     * until a monthly membership renewed every five weeks.
     */
    const periodEnd = at("2026-09-01T00:00:00Z");
    const paidLate = at("2026-08-29T00:00:00Z");
    expect(nextPeriodEnd(periodEnd, "month", paidLate).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("starts again from now when the last period is long gone", () => {
    // Counting forward from a period that ended in March would hand somebody
    // paying in September a period that has already expired.
    const lapsed = at("2026-03-01T00:00:00Z");
    const now = at("2026-09-11T00:00:00Z");
    const next = nextPeriodEnd(lapsed, "month", now);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.toISOString()).toBe("2026-10-11T00:00:00.000Z");
  });

  it("starts from now for a membership that has never had a period", () => {
    const now = at("2026-08-12T10:00:00Z");
    expect(nextPeriodEnd(null, "month", now).toISOString()).toBe(
      "2026-09-12T10:00:00.000Z",
    );
  });
});

describe("which cycle a membership is on", () => {
  it("reads the billing mode rather than guessing from a Stripe id", () => {
    /*
     * A manual membership has no Stripe id, but so does a card one for the
     * few seconds between our row and Stripe's webhook — inferring the mode
     * from the id being null would call that member manual and stop charging
     * their card.
     */
    expect(isManual({ billingMode: "manual" })).toBe(true);
    expect(isManual({ billingMode: "stripe" })).toBe(false);
  });
});

describe("what Sailo keeps from a membership", () => {
  it("carries Stripe's percentage as the basis points every plan is written in", () => {
    /*
     * The three rates on the plan ladder, in the unit `platformFeeBp` uses.
     * A mismatch here is not a rounding argument — it is a seller billed at
     * the wrong tier on every renewal for the life of their membership.
     */
    expect(feeBpFromPercent(3)).toBe(300);
    expect(feeBpFromPercent(2)).toBe(200);
    expect(feeBpFromPercent(1)).toBe(100);
    expect(feePercentFromBp(300)).toBe(3);
    expect(feePercentFromBp(100)).toBe(1);
  });

  it("folds absent and zero into the same answer", () => {
    /*
     * Checkout omits `application_fee_percent` when the fee is zero, and an
     * update sets it to `0.0` — confirmed against the live API, not assumed.
     * Two values for one fact would make the sweep rewrite those rows every
     * hour for ever without ever reaching agreement.
     */
    expect(feeBpFromPercent(null)).toBe(0);
    expect(feeBpFromPercent(undefined)).toBe(0);
    expect(feeBpFromPercent(0)).toBe(0);
  });

  it("survives a fee Stripe returned with decimals", () => {
    // Stripe allows two decimal places; 0.5% is what the live scenario sells at.
    expect(feeBpFromPercent(0.5)).toBe(50);
    expect(feeBpFromPercent(2.55)).toBe(255);
    expect(feePercentFromBp(50)).toBe(0.5);
  });

  it("round-trips every whole basis point the ladder can produce", () => {
    /*
     * The property that makes the stored integer safe to compare with `ne`:
     * bp -> percent -> bp is the identity, so a row that is in step never
     * looks drifted and never gets re-sent.
     */
    for (const bp of [0, 1, 50, 100, 200, 255, 300, 1200]) {
      expect(feeBpFromPercent(feePercentFromBp(bp))).toBe(bp);
    }
  });

  it("keeps sweeping the statuses Stripe can still invoice", () => {
    /*
     * `past_due` and `unpaid` are the two that a set borrowed from the access
     * rules would wrongly drop. Stripe is still retrying the first, and the
     * second is a subscription the seller can revive — both can raise another
     * invoice, and an invoice is what reads the fee.
     */
    expect(canStillInvoice("active")).toBe(true);
    expect(canStillInvoice("trialing")).toBe(true);
    expect(canStillInvoice("past_due")).toBe(true);
    expect(canStillInvoice("unpaid")).toBe(true);
    expect(canStillInvoice("incomplete")).toBe(true);
  });

  it("skips the ones that will never be invoiced again", () => {
    expect(canStillInvoice("canceled")).toBe(false);
    expect(canStillInvoice("incomplete_expired")).toBe(false);
  });
});
