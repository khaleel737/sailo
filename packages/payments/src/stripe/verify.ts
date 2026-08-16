import "server-only";
import type Stripe from "stripe";
import { stripe } from "./client";

/**
 * Deciding whether an event is really Stripe's, and whether we care about it.
 *
 * The first question a webhook route asks, and the only one that has to be
 * answered before the body is parsed — everything downstream treats the event
 * as trusted, so this is the boundary that earns it.
 */

/** Events we act on. Anything else is acknowledged and ignored. */
export const HANDLED = new Set([
  "checkout.session.completed",
  /*
   * Delayed-notification methods — iDEAL, SEPA, Bancontact, Boleto and the
   * rest. Their session completes with `payment_status: "unpaid"` and the money
   * is confirmed minutes to days later by one of these. Without them a buyer
   * pays by any non-card European or Asian method and the order never leaves
   * "unpaid".
   */
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  /*
   * A seller's subscription payment landing. Nothing about the plan changes
   * here — `customer.subscription.*` does that — but it is the only event
   * that says money actually arrived, which is what the refer-a-creator
   * ledger accrues on. A subscription that exists is a promise; an invoice
   * that is paid is revenue.
   */
  "invoice.paid",
  "charge.refunded",
  "checkout.session.expired",
  "account.updated",
  // Chargebacks. A buyer disputing a card payment takes the money straight
  // back out of the seller's balance, and nothing else tells us it happened.
  "charge.dispute.created",
  "charge.dispute.closed",
]);

/**
 * The signing secrets a route will accept, comma separated.
 *
 * A list rather than one string so a deployment can rotate a secret without a
 * window where half the deliveries fail, and so both endpoints can be pointed
 * at one URL if someone ever wants that.
 */
export function signingSecrets(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);
}

/**
 * Verifies a delivery against each configured secret in turn.
 *
 * Three outcomes, not two. A *thin* payload is the third: Stripe's v2 event
 * destinations send a notification with no `data.object`, and
 * `constructEvent` refuses it outright. That is not a forged request and must
 * not be answered with a 400 — Stripe would retry it forever and eventually
 * disable the destination, taking the working payments down with it. It is
 * simply a format this integration does not consume, so it is verified with
 * the right parser and acknowledged.
 */
export function verifyEvent(
  payload: string,
  signature: string,
  secrets: string[],
):
  | { event: Stripe.Event }
  | { thin: true; type: string }
  | { error: string } {
  let lastError = "no signing secret matched";

  for (const secret of secrets) {
    try {
      return {
        event: stripe().webhooks.constructEvent(payload, signature, secret),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown";
    }
  }

  // Only after every secret has failed the snapshot parser: a thin payload
  // fails it for the shape, not the signature, so try the v2 parser too.
  for (const secret of secrets) {
    try {
      const notification = stripe().parseEventNotification(
        payload,
        signature,
        secret,
      );
      return { thin: true, type: notification.type };
    } catch {
      // Not a thin event either; fall through to the original error.
    }
  }

  return { error: lastError };
}
