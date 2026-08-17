/**
 * Reading what Stripe actually sent.
 *
 * A subscription's period end and an invoice's subscription id both arrive in more than one
 * shape depending on the API version and the event, and both are the value the rest of this
 * folder keys off. One reader each, so a shape Stripe adds is handled in one place.
 */

import "server-only";
import type Stripe from "stripe";

/* --------------------------------------------------------------------------
   Reading Stripe's shapes

   Both of these moved in recent API versions and the compiler cannot catch a
   field that is simply absent at runtime, so they are read in one place with
   the reason written down.
-------------------------------------------------------------------------- */

/**
 * When the period the member has paid for runs out.
 *
 * On the *item*, not the subscription. `Subscription.current_period_end` was
 * removed in the 2025-03 API version and this integration pins a later one —
 * reading the old field would compile (it is `any` through a cast) and return
 * undefined forever, which means every member's access would expire the
 * instant it was checked, or never expire at all depending on which way the
 * null was read. Both are silent.
 *
 * The furthest item wins: a subscription can hold several items on different
 * cycles, and access should last as long as the longest thing paid for.
 */
export function periodEndOf(sub: Stripe.Subscription): Date | null {
  const ends = sub.items?.data
    ?.map((item) => item.current_period_end)
    .filter((n): n is number => typeof n === "number");
  if (!ends || ends.length === 0) return null;
  return new Date(Math.max(...ends) * 1000);
}

/**
 * The subscription an invoice was raised for.
 *
 * `Invoice.subscription` is gone in this API version too; it lives under
 * `parent.subscription_details`. An invoice with no subscription parent is a
 * one-off invoice the seller raised in their own dashboard — not ours, and
 * not something to write an order for.
 */
export function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const link = invoice.parent?.subscription_details?.subscription;
  if (!link) return null;
  return typeof link === "string" ? link : link.id;
}

export const idOf = (value: string | { id: string } | null | undefined): string | null =>
  !value ? null : typeof value === "string" ? value : value.id;
