/**
 * Which payment states a seller may set, now in
 * `@sailo/core/payment-status`.
 *
 * Kept as a re-export. It sits in `@sailo/core` beside `ORDER_STATUSES` rather
 * than in `@sailo/payments`, because it describes an *order's* state and not a
 * rail's — and because `@sailo/payments` is a server package that would drag
 * Stripe into the phone's bundle behind it.
 *
 * It left because confirming that money arrived is the most phone-shaped
 * action in the product — a seller at a market stall, paid
 * in cash — and the list of states they may set is a rule, not a lookup:
 * `refunded` is written by the refund path and by nothing else, so a dropdown
 * that offered it would let a seller mark an order refunded without any money
 * moving.
 */

export * from "@sailo/core/payment-status";
