import type { WebhookEvent } from "./events";

/**
 * Which membership events a change actually represents.
 *
 * Stripe sends one `customer.subscription.updated` for every kind of change —
 * a plan swap, a cancellation, a resumption, a card that finally cleared, a
 * trial ending — and the event name says nothing about which. Deriving that
 * from the *event* is therefore impossible; it has to come from comparing the
 * row we held against the row we just wrote, which is exactly what this does.
 *
 * Pure, and beside the catalogue rather than in `@sailo/core`, because it
 * returns the catalogue's own names: `core` is what `events.ts` imports for
 * its payload shapes, so a module there naming `WebhookEvent` would close the
 * loop turbo already refused once. Nothing here touches a database, a Stripe
 * account or a network, so it tests as a truth table — which is the point. The
 * alternative, a chain of `if` statements inside the webhook handler, is the
 * version that quietly starts firing `subscription.cancelled` on every renewal,
 * because nobody can see the whole truth table at once.
 *
 * **It returns a list, not one event.** A single Stripe update legitimately
 * carries two changes: a member who downgrades *and* cancels in the same call
 * to the billing portal has done both, and a consumer syncing plan levels needs
 * the first while one revoking access needs the second. Emitting only the
 * "most important" one means somebody's integration silently misses the other.
 *
 * Order is stable and meaningful: the plan change comes before the lifecycle
 * change, so a consumer processing them in sequence ends on the state the
 * member is actually in.
 */

export type SubscriptionState = {
  status: string;
  cancelAtPeriodEnd: boolean;
  priceCents: number;
  interval: string;
};

/**
 * The statuses that mean the arrangement is over rather than merely unpaid.
 *
 * `past_due` is deliberately absent. A card that failed is a subscription that
 * still exists and will very likely recover on Stripe's next retry — treating
 * it as an ending is how a member loses their Discord role over a card that
 * expired and was updated the same afternoon. `subscription.payment_failed`
 * is the event for that, and it is emitted from the invoice handler where the
 * failure actually happened.
 */
const ENDED = new Set(["canceled", "incomplete_expired"]);

export function subscriptionTransitions(
  before: SubscriptionState | null,
  after: SubscriptionState,
): WebhookEvent[] {
  /*
   * No `before` means we had never seen this subscription — a row written by
   * `resolveSubscription` recovering from an out-of-order delivery, most
   * often. That is a creation, and `handleSubscriptionCheckout` will have
   * emitted it or will shortly; emitting a second one here would double every
   * signup for consumers that key on the event rather than on the id.
   */
  if (!before) return [];

  const events: WebhookEvent[] = [];

  /*
   * What they pay, or how often. Either counts — a member moving from monthly
   * to annual at the same monthly-equivalent price has changed plan in every
   * sense a consumer cares about, and comparing only the amount would miss it.
   */
  if (
    before.priceCents !== after.priceCents ||
    before.interval !== after.interval
  ) {
    events.push("subscription.plan_changed");
  }

  const endedBefore = ENDED.has(before.status);
  const endedAfter = ENDED.has(after.status);

  if (!endedBefore && endedAfter) {
    /*
     * Ended here rather than cancelled, even though this arrived as an update.
     *
     * Stripe can move a subscription straight to `canceled` on an update —
     * an immediate cancellation, or the end of a dunning cycle — without ever
     * sending the `deleted` event that normally carries it. A consumer waiting
     * only for `subscription.ended` from the delete handler would keep serving
     * a member who stopped paying weeks ago.
     */
    events.push("subscription.ended");
    return events;
  }

  /*
   * The member asked to stop, or changed their mind. Only when the arrangement
   * is otherwise unchanged in status — a flag flip on a subscription that is
   * already over is Stripe tidying up, not a decision anybody made.
   */
  if (!endedAfter) {
    if (!before.cancelAtPeriodEnd && after.cancelAtPeriodEnd) {
      events.push("subscription.cancelled");
    } else if (before.cancelAtPeriodEnd && !after.cancelAtPeriodEnd) {
      events.push("subscription.resumed");
    }
  }

  return events;
}
