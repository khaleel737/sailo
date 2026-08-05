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

/** One tone per status, so every table colours them the same way. */
export const PAYMENT_STATUS_TONES = {
  unpaid: "neutral",
  pending: "amber",
  paid: "green",
  refunded: "red",
  disputed: "red",
} as const satisfies Record<PaymentStatus, string>;
