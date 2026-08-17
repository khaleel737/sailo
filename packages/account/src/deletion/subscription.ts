/**
 * Making sure a deleted store stops being charged.
 *
 * `isMissing` is exported so it can be tested. It is the function that decides a Stripe
 * error means success, and it is expensive to get wrong in either direction: too loose
 * and a live subscription is reported cancelled, too strict and a retry after a mid-way
 * crash can never finish.
 */

import "server-only";
import { stripe, billingEnabled } from "@sailo/payments";

/**
 * Cancels the platform subscription and confirms it really is cancelled.
 *
 * Immediately, not at period end: the store is gone, so "keep it running
 * until the month is up" would mean charging for something that no longer
 * exists. A subscription Stripe has never heard of counts as cancelled —
 * that is what makes a retry after a mid-way crash finish rather than fail.
 */
export async function cancelPlatformSubscription(subscriptionId: string | null): Promise<void> {
  if (!subscriptionId || !billingEnabled()) return;

  try {
    await stripe().subscriptions.cancel(subscriptionId);
  } catch (error) {
    if (!isMissing(error)) throw error;
    return;
  }

  // Read it back rather than trust the call — the whole point of this step is
  // that nobody keeps being charged, and that deserves a confirmation.
  const confirmed = await stripe().subscriptions.retrieve(subscriptionId);
  if (confirmed.status !== "canceled") {
    throw new Error(
      `[sailo] subscription ${subscriptionId} is still ${confirmed.status} after cancel`,
    );
  }
}

/** Stripe's "this object is gone", which for a cancellation means success. */
export function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "resource_missing"
  );
}
