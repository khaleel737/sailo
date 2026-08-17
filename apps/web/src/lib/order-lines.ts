/**
 * What an order contains, in the two halves it split into.
 *
 * The shape of a line and the rules for naming one are `@sailo/core/order-lines`
 * — pure, so `@sailo/email` and `@sailo/notifications` can render an order they
 * were handed without needing a database. Reading the rows is
 * `@sailo/commerce/order-lines`, which does.
 *
 * Both are re-exported here because fourteen files in this app import
 * `@/lib/order-lines` and the split is not their concern: a page that lists an
 * order fetches the lines and titles them in the same breath.
 */

export * from "@sailo/core/order-lines";
export * from "@sailo/commerce/order-lines";
