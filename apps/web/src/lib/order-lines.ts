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

/**
 * The order's human name — "#INV-0007", or the first block of its uuid when
 * no invoice exists yet. One function so the list, the detail header and the
 * palette can never disagree about what an order is called (spec 04: the
 * single biggest scanability gap vs Shopify was product-title-as-identity).
 */
export function orderNumber(
  orderId: string,
  invoiceNumber?: string | null,
): string {
  return `#${invoiceNumber ?? orderId.slice(0, 8)}`;
}
