import type Stripe from "stripe";

/**
 * What the buyer actually paid, when Stripe converted it.
 *
 * The sibling of `taxFromSession`, and here for the same reason: one place
 * that turns Stripe's shape into ours, so nothing downstream has to know which
 * field carries which fact.
 *
 * Adaptive Pricing presents a local amount to buyers abroad — the only way a
 * Dutch buyer is ever offered iDEAL, which settles in EUR and nothing else.
 * Everything about the seller's money is unaffected: `amount_total` and
 * `currency` on the session remain the shop's, so the order, the payout and
 * the invoice all continue to agree. What changes is that the buyer's card
 * statement now says something else, and this is the only place Stripe reports
 * it — `presentment_details` exists on the Checkout Session and on the
 * PaymentIntent, and on nothing that outlives them.
 *
 * Pure and free of any database access, so it can be tested against recorded
 * session payloads rather than against a live account.
 */

export type Presentment = {
  /** ISO code the buyer saw, lower case as Stripe reports it. */
  presentmentCurrency: string;
  /** What they paid, in that currency's minor units. */
  presentmentAmountCents: number;
};

export function presentmentFromSession(
  session: Pick<Stripe.Checkout.Session, "presentment_details" | "currency">,
): Presentment | null {
  const details = session.presentment_details;
  if (!details) return null;

  const presentmentCurrency = details.presentment_currency?.toLowerCase();
  if (!presentmentCurrency) return null;

  /*
   * Stripe populates `presentment_details` on every session once Adaptive
   * Pricing is on, including the ones it decided not to convert — where it
   * simply echoes the integration currency back. Recording that would put a
   * "converted from" note on an order nobody converted, so a presentment that
   * matches the charge is the same as no presentment at all.
   */
  if (presentmentCurrency === session.currency?.toLowerCase()) return null;

  /*
   * Zero is a legitimate amount — a fully discounted order really is settled
   * for nothing — so this checks the type rather than the truthiness. `??` on
   * a `0` would have been fine; `||` on one would not, which is exactly the
   * bug this shape avoids.
   */
  if (typeof details.presentment_amount !== "number") return null;

  return { presentmentCurrency, presentmentAmountCents: details.presentment_amount };
}
