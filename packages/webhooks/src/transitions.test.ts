import { describe, expect, it } from "vitest";
import { subscriptionTransitions, type SubscriptionState } from "./transitions";

/**
 * The truth table behind three of the seven membership events.
 *
 * Stripe names a plan swap, a cancellation, a resumption, a recovered card and
 * an ended trial identically — `customer.subscription.updated` — so which of
 * them happened can only come from comparing the row we held against the row we
 * wrote. Everything that can go wrong here is silent in production: an event
 * that never fires looks like a broken integration, and one that fires on every
 * renewal revokes a paying member's access.
 */

const state = (over: Partial<SubscriptionState> = {}): SubscriptionState => ({
  status: "active",
  cancelAtPeriodEnd: false,
  priceCents: 1000,
  interval: "month",
  ...over,
});

describe("subscriptionTransitions", () => {
  it("says nothing happened when nothing changed", () => {
    // The common case by far: Stripe sends an update for the period rolling
    // over, and a Zap that fired on it would run twelve times a year for free.
    expect(subscriptionTransitions(state(), state())).toEqual([]);
  });

  it("says nothing for a subscription it had never seen", () => {
    /*
     * A row recovered out of order by `resolveSubscription`. The checkout
     * handler emits `subscription.created` for it, so emitting anything here
     * would double every signup for a consumer keying on the event.
     */
    expect(subscriptionTransitions(null, state())).toEqual([]);
  });

  it("reports a price change", () => {
    expect(
      subscriptionTransitions(state(), state({ priceCents: 2000 })),
    ).toEqual(["subscription.plan_changed"]);
  });

  it("reports a change of interval at the same price", () => {
    /*
     * Monthly to annual is a plan change in every sense a consumer cares
     * about, and comparing only the amount would miss it entirely.
     */
    expect(
      subscriptionTransitions(state(), state({ interval: "year" })),
    ).toEqual(["subscription.plan_changed"]);
  });

  it("reports the member asking to stop", () => {
    expect(
      subscriptionTransitions(state(), state({ cancelAtPeriodEnd: true })),
    ).toEqual(["subscription.cancelled"]);
  });

  it("reports the member changing their mind", () => {
    expect(
      subscriptionTransitions(
        state({ cancelAtPeriodEnd: true }),
        state({ cancelAtPeriodEnd: false }),
      ),
    ).toEqual(["subscription.resumed"]);
  });

  it("does not re-report a cancellation that was already pending", () => {
    // Every later update carries `cancel_at_period_end: true` too. Without the
    // before-and-after comparison this fires on all of them.
    expect(
      subscriptionTransitions(
        state({ cancelAtPeriodEnd: true }),
        state({ cancelAtPeriodEnd: true }),
      ),
    ).toEqual([]);
  });

  it("reports an ending, even when it arrives as an update", () => {
    /*
     * Stripe can move a subscription straight to `canceled` on an update — an
     * immediate cancellation, or the end of dunning — with no `deleted` event
     * behind it. A consumer waiting only on the delete handler would keep
     * serving a member who stopped paying weeks ago.
     */
    expect(
      subscriptionTransitions(state(), state({ status: "canceled" })),
    ).toEqual(["subscription.ended"]);
  });

  it("treats an expired incomplete signup as an ending", () => {
    expect(
      subscriptionTransitions(
        state({ status: "incomplete" }),
        state({ status: "incomplete_expired" }),
      ),
    ).toEqual(["subscription.ended"]);
  });

  it("does not treat a failed card as an ending", () => {
    /*
     * The one that would cost a seller members. `past_due` is a card that will
     * very likely clear on Stripe's next retry, and a consumer that revoked
     * access here would cut off somebody whose card expired and was replaced
     * the same afternoon. `subscription.payment_failed` covers it instead, and
     * it is emitted from the invoice handler where the failure happened.
     */
    expect(
      subscriptionTransitions(state(), state({ status: "past_due" })),
    ).toEqual([]);
  });

  it("reports a recovery from past due as nothing at all", () => {
    // Coming back from `past_due` is not a resumption — nobody cancelled.
    expect(
      subscriptionTransitions(state({ status: "past_due" }), state()),
    ).toEqual([]);
  });

  it("reports both when a member downgrades and cancels at once", () => {
    /*
     * One call to the billing portal can legitimately do both. A consumer
     * syncing plan levels needs the first and one revoking access needs the
     * second, so returning only the "most important" silently loses one.
     */
    expect(
      subscriptionTransitions(
        state(),
        state({ priceCents: 500, cancelAtPeriodEnd: true }),
      ),
    ).toEqual(["subscription.plan_changed", "subscription.cancelled"]);
  });

  it("does not report a cancellation on a subscription that just ended", () => {
    /*
     * Stripe clears `cancel_at_period_end` when it finally cancels, and sets
     * the status in the same update. Reporting both would tell a consumer the
     * member asked to stop at the very moment they actually stopped — two
     * events for one fact, in the wrong order.
     */
    expect(
      subscriptionTransitions(
        state({ cancelAtPeriodEnd: true }),
        state({ status: "canceled", cancelAtPeriodEnd: false }),
      ),
    ).toEqual(["subscription.ended"]);
  });

  it("does not re-report an ending on a subscription already ended", () => {
    expect(
      subscriptionTransitions(
        state({ status: "canceled" }),
        state({ status: "canceled" }),
      ),
    ).toEqual([]);
  });
});
