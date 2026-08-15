/**
 * How to ask what an order contains, now in `@sailo/commerce/order-lines`.
 *
 * Kept as a re-export for the fourteen files that import `@/lib/order-lines`.
 *
 * It had to leave because a shipping notice and a refund notice both name what
 * was bought, and `@sailo/email` composes both for two apps. The module's own
 * header explains why a second copy would be dangerous rather than untidy: an
 * order stores what was bought *twice* — `orderItems` rows and a set of summary
 * columns on the order itself — and this is the one function that knows which
 * of the two to believe.
 */

export * from "@sailo/commerce/order-lines";
