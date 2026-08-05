/**
 * The order lifecycle, in one place.
 *
 * Three surfaces render an order's status — the dashboard's recent list, the
 * orders table, and the select that changes it — and each used to carry its
 * own copy. They disagreed: two printed the raw enum (`completed`), the third
 * leaned on CSS `capitalize`, so the same order read three ways depending on
 * where you saw it.
 *
 * Labels live in the admin dictionary rather than here, because "Shipped" is a
 * word a seller reads and `shipped` is a value the database stores.
 */

export const ORDER_STATUSES = [
  "new",
  "confirmed",
  "shipped",
  "completed",
  "cancelled",
  "refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Badge tone per status. Only the two that need acting on carry warm colour. */
export const ORDER_STATUS_TONE = {
  new: "blue",
  confirmed: "amber",
  shipped: "blue",
  completed: "green",
  cancelled: "neutral",
  refunded: "red",
} as const satisfies Record<OrderStatus, string>;

export function orderStatusTone(status: string) {
  return (
    ORDER_STATUS_TONE[status as OrderStatus] ?? ("neutral" as const)
  );
}

/**
 * The written label, falling back to the stored value so a status added to the
 * database before the dictionary still renders something rather than nothing.
 */
export function orderStatusLabel(
  status: string,
  labels: Record<string, string>,
) {
  return labels[status] ?? status;
}
