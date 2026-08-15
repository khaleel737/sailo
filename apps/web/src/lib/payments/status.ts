/**
 * Which payment states a seller may set, now in
 * `@sailo/payments/order-status`.
 *
 * Kept as a re-export. It left because confirming that money arrived is the
 * most phone-shaped action in the product — a seller at a market stall, paid
 * in cash — and the list of states they may set is a rule, not a lookup:
 * `refunded` is written by the refund path and by nothing else, so a dropdown
 * that offered it would let a seller mark an order refunded without any money
 * moving.
 */

export * from "@sailo/payments/order-status";
