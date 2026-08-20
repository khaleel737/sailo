/* Where a membership stands. */

/**
 * Every status a subscription row can hold.
 *
 * Written down here for the reason `payment-status.ts` gives about its own
 * list, and with the same history behind it: the states were spread across a
 * column comment that named six, a `SETTLED_STATUSES` pair, an `OPEN_STATUSES`
 * set of three and a lone `PAUSED_STATUS` constant, and no one place said what
 * the whole vocabulary was. The public API is what forced the issue — an
 * endpoint that filters on `status` has to publish the values it accepts, and
 * a hand-copied list in a documentation file is the copy that goes stale first.
 *
 * Six of these come from Stripe and travel with the subscription object; the
 * seventh, `paused`, is ours. A paused membership is deliberately not in
 * Stripe's vocabulary — it is a seller holding somebody's place without
 * billing them, which Stripe models as a cancellation and we do not, because a
 * member who comes back should not have to re-join.
 *
 * In `@sailo/core` rather than beside the membership rules in
 * `@sailo/commerce`, because the REST catalogue and the OpenAPI generator both
 * need it and neither may pull a `server-only` module behind it.
 */
export const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "paused",
  "unpaid",
  "canceled",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/**
 * The statuses in which a member still has what they paid for.
 *
 * `past_due` is in the list and that is the point of having one: a card that
 * failed this morning has not ended a membership, and an integration that
 * revokes a Discord role on the first failed charge takes access away from
 * somebody whose second attempt succeeds that afternoon. `canceled` is absent
 * even though a cancelled member often still has time left — that time is
 * `currentPeriodEnd`, and reading it is the only honest way to answer the
 * question.
 */
export const ACTIVE_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
] as const;

export function isActiveSubscriptionStatus(value: string): boolean {
  return (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}
