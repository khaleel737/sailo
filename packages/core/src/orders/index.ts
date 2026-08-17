/**
 * The vocabulary of an order's state, and of what it contains.
 *
 * `order-status` is fulfilment, `payment-status` is money, and the two are
 * deliberately separate axes — a paid order can be unshipped and a shipped one
 * unpaid. `order-lines` is the shape of a line and how to name one.
 *
 * Reading an order from the database is `@sailo/commerce/orders`. This is the
 * half with no connection in it, which is what lets the phone, an email and a
 * push notification all describe the same order without one.
 */
export * from "./order-status";
export * from "./payment-status";
export * from "./order-lines";
