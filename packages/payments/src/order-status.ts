/* Where an order's money stands. */

/**
 * Every payment status an order can hold.
 *
 * Defined once because it had drifted into four places that disagreed: the
 * column comment listed three, the seller's dropdown offered four, and the
 * webhook wrote a fifth. A status the UI doesn't know about renders as
 * whatever happens to be first in a `<select>`, which is how a disputed order
 * came to display as "Unpaid".
 */
export const PAYMENT_STATUSES = [
  "unpaid",
  "pending",
  "paid",
  "refunded",
  "disputed",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * The ones a seller may set by hand.
 *
 * `disputed` is missing on purpose: it is a fact a bank reported to us, not an
 * opinion the seller gets to hold, and letting them clear it from a dropdown
 * would hide money that has already left their balance.
 */
export const SELLER_SETTABLE_PAYMENT_STATUSES = [
  "unpaid",
  "pending",
  "paid",
  "refunded",
] as const;

export function isPaymentStatus(value: string): value is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value);
}

export function isSellerSettablePaymentStatus(value: string): boolean {
  return (SELLER_SETTABLE_PAYMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * The statuses an order can still be waiting for a bank transfer in.
 *
 * The action that consumes this is public and unauthenticated: it is how a
 * buyer who paid by transfer tells the seller the money is on its way, and it
 * finds the order by id alone. So it may only act on an order whose money is
 * genuinely unsettled.
 *
 * This is a list rather than a `!== "paid"` check because of `disputed`. A
 * chargeback has already pulled the money back out of the seller's balance,
 * and moving that order to "pending" would show them a sale awaiting
 * confirmation where in fact they had lost one — hiding the reversal behind a
 * status that looks like progress. `SELLER_SETTABLE_PAYMENT_STATUSES`
 * deliberately withholds `disputed` from the shop's own owner; a stranger must
 * not be able to do what the owner is forbidden. `refunded` and `paid` are
 * settled facts for the same reason.
 */
export const TRANSFERABLE_PAYMENT_STATUSES = ["unpaid", "pending"] as const;

export function awaitsTransfer(value: string): boolean {
  return (TRANSFERABLE_PAYMENT_STATUSES as readonly string[]).includes(value);
}

export type PaymentReferenceCheck =
  | { ok: true; reference: string }
  | { ok: false; error: string };

/**
 * Whether a buyer's transfer reference may be attached to an order.
 *
 * Returns the trimmed reference so the caller writes exactly what was
 * checked, rather than re-deriving it and drifting.
 */
export function checkPaymentReference(
  order: { paymentStatus: string },
  raw: string,
): PaymentReferenceCheck {
  const reference = raw.trim().slice(0, 200);
  if (!reference) return { ok: false, error: "Add the transfer reference." };

  if (!awaitsTransfer(order.paymentStatus)) {
    // Deliberately does not name the status: the caller proved they know an
    // order id, not that they are the buyer, and "this order is disputed" is
    // not a fact to hand out.
    return { ok: false, error: "This order is no longer awaiting a transfer." };
  }

  return { ok: true, reference };
}

/** One tone per status, so every table colours them the same way. */
export const PAYMENT_STATUS_TONES = {
  unpaid: "neutral",
  pending: "amber",
  paid: "green",
  refunded: "red",
  disputed: "red",
} as const satisfies Record<PaymentStatus, string>;
